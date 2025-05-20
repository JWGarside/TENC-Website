require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Anthropic } = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// Path to the few-shot examples PDF that will be included with every request
const FEW_SHOT_EXAMPLES_PATH = path.join(__dirname, 'assets', 'few_shot_examples.pdf');

// Serve static files from the public directory
app.use(express.static('public'));

// Set up file storage for uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Use a unique name to prevent overwriting
        const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function (req, file, cb) {
        if (file.fieldname === 'paper') {
            // Only accept PDFs for papers
            if (file.mimetype !== 'application/pdf') {
                return cb(new Error('Only PDF files are allowed for research papers'));
            }
        } else if (file.fieldname === 'code') {
            // For code files, we'll check file extension
            const validExtensions = ['.py', '.js', '.cpp', '.java', '.r', '.c', '.h', '.ipynb', '.m'];
            const fileExt = path.extname(file.originalname).toLowerCase();
            if (!validExtensions.includes(fileExt)) {
                return cb(new Error('Invalid code file extension'));
            }
        }
        cb(null, true);
    }
});

/**
 * Compare a research paper and code file using the Claude API
 * 
 * @param {string} pdfPath - Path to the PDF research paper
 * @param {string} codePath - Path to the code file
 * @returns {Promise<string>} - Claude's response
 */
async function comparePaperAndCode(pdfPath, codePath) {
    // Initialize the Anthropic client
    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || "your_api_key_here" // Replace with your API key or use .env file
    });
    
    // Read and encode PDF files as Base64
    const pdfData = fs.readFileSync(pdfPath).toString('base64');
    const fewShotExamplesData = fs.readFileSync(FEW_SHOT_EXAMPLES_PATH).toString('base64');
    
    // Read the code file
    const codeContent = fs.readFileSync(codePath, 'utf-8');
    
    // Determine file extension to help Claude understand the language
    const fileExtension = path.extname(codePath).slice(1);
    
    // System prompt to guide formatting
    const systemPrompt = `You are a research reproducibility analyzer that specializes in identifying discrepancies between academic papers and their code implementations. 

    You will compare the provided research paper and code to identify any discrepancies that could affect reproducibility or validity.

    FORMAT YOUR RESPONSE USING THE EXACT STRUCTURE FROM THE FEW-SHOT EXAMPLES. The few-shot examples PDF shows the expected format and level of detail for your analysis.

    You must analyze both documents carefully and:
    1. Identify discrepancies that would meaningfully affect reproducibility or results
    2. Format your response in a consistent way matching the examples
    3. Include specific section references from the paper and line numbers from the code
    4. Explain the impact of each discrepancy on reproducibility

    If no discrepancies are found that would meaningfully impact results, respond with "NO MAJOR DISCREPANCIES FOUND" followed by a brief explanation.`;
    
    // User prompt
    const prompt = `Compare the provided research paper and code implementation to identify any discrepancies that could affect the reproducibility or validity of the work. Focus on differences in methodology, algorithms, mathematical approaches, or key implementation details that might lead to different results or impede replication. Ignore minor deviations in code style, variable names, or superficial details if they are unlikely to change the interpretation or reproducibility of the work.

    Use the examples from the attached PDF "few_shot_examples.pdf" as a reference for your decision.

    If none of the discrepancies are found to impact the results, respond simply with "NO MAJOR DISCREPANCIES FOUND" followed by a short message saying that the code is a faithful implementation of the paper.`;

    
    console.log(`Analyzing paper against code file with few-shot examples`);
    
    try {
        // Send request to Claude API
        const response = await anthropic.messages.create({
            model: "claude-3-7-sonnet-20250219", // You can change the model as needed
            max_tokens: 1024, // Increased token limit for more detailed analysis
            temperature: 0.2, // Lower temperature for more consistent outputs
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "document",
                            source: {
                                type: "base64",
                                media_type: "application/pdf",
                                data: fewShotExamplesData
                            }
                        },
                        {
                            type: "document",
                            source: {
                                type: "base64",
                                media_type: "application/pdf",
                                data: pdfData
                            }
                        },
                        {
                            type: "text", 
                            text: `I'm also providing a ${fileExtension} code file:\n\n\`\`\`${fileExtension}\n${codeContent}\n\`\`\`\n\n${prompt}`
                        }
                    ]
                }
            ]
        });
        
        // Get Claude's response text
        return response.content[0].text;
    } catch (error) {
        console.error('Error comparing paper and code:', error);
        if (error.response) {
            console.error('API Error Details:', error.response.data);
        }
        throw error;
    }
}


// API endpoint to handle comparison
app.post('/api/compare', upload.fields([
    { name: 'paper', maxCount: 1 },
    { name: 'code', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.paper || !req.files.code) {
            return res.status(400).json({ 
                error: 'Missing required files. Please upload both a paper and code file.' 
            });
        }

        const paperPath = req.files.paper[0].path;
        const codePath = req.files.code[0].path;

        // Verify that the few-shot examples file exists
        if (!fs.existsSync(FEW_SHOT_EXAMPLES_PATH)) {
            return res.status(500).json({
                error: 'Few-shot examples file not found. Please contact the administrator.',
                details: `Missing file: ${FEW_SHOT_EXAMPLES_PATH}`
            });
        }

        // Run the comparison
        const analysisResult = await comparePaperAndCode(paperPath, codePath);

        // Clean up uploaded files
        fs.unlinkSync(paperPath);
        fs.unlinkSync(codePath);

        return res.json({
            status: 'success',
            analysis: analysisResult
        });
    } catch (error) {
        console.error('Error in comparison process:', error);
        return res.status(500).json({
            error: 'An error occurred during analysis',
            details: error.message
        });
    }
});

// Render the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    
    // Check if few-shot examples file exists
    if (!fs.existsSync(FEW_SHOT_EXAMPLES_PATH)) {
        console.warn(`WARNING: Few-shot examples file not found at ${FEW_SHOT_EXAMPLES_PATH}`);
        console.warn('Make sure to create the assets directory and add the few_shot_examples.pdf file');
    } else {
        console.log(`Few-shot examples file found at ${FEW_SHOT_EXAMPLES_PATH}`);
    }
});