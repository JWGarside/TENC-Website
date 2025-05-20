if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { v4: uuidv4 } = require('uuid');
const semanticChunking = require('./semanticChunking'); // Ensure this file exists in the same directory

const app = express();
const port = process.env.PORT || 3000;

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
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for PDF, ZIP might need more if code is large
    fileFilter: function (req, file, cb) {
        if (file.fieldname === 'paper') {
            // Only accept PDFs for papers
            if (file.mimetype !== 'application/pdf') {
                return cb(new Error('Only PDF files are allowed for research papers'));
            }
        } else if (file.fieldname === 'code') {
            // For code files, accept only ZIP archives
            if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
                const fileExt = path.extname(file.originalname).toLowerCase();
                if (fileExt !== '.zip') {
                    return cb(new Error('Only ZIP archives (.zip) are allowed for code submissions'));
                }
            }
        }
        cb(null, true);
    }
});

/**
 * Compare a research paper and code from a ZIP archive using the Google Gemini API
 * 
 * @param {string} pdfPath - Path to the PDF research paper
 * @param {string} zipPath - Path to the ZIP archive containing code files
 * @returns {Promise<string>} - Gemini's response
 */
async function analyzeWithGemini(pdfPath, zipPath) {
    // Initialize the Google Generative AI client
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error("Google API key not found. Please set GOOGLE_API_KEY environment variable.");
        throw new Error("Google API key not found. Server configuration error.");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" });

    // Read and encode PDF file as Base64
    const pdfData = fs.readFileSync(pdfPath).toString('base64');

    // Semantically chunk the zip archive
    // Ensure semanticChunking.js is in the same directory or update path
    const { codeFiles, readmeContent } = await semanticChunking.chunkZipArchive(zipPath);
    
    const pdfName = path.basename(pdfPath, path.extname(pdfPath));
    const zipName = path.basename(zipPath, path.extname(zipPath));

    // Prompt from CS2_gemini_test_pro.js
    const prompt = (
        "# Research Code Reproducibility Analysis Prompt\n\n" +
         "Analyze the provided research paper (PDF) and code implementation (ZIP) to assess reproducibility:\n\n. " +
        "## Analysis Steps\n" +
        "1. Identify the paper's core claims and key methodological details\n. Note key methodological details explicitly described in the paper. Pay special attention to architecture specifications, algorithms, and parameter values. Identify which aspects are presented as fundamental to the approach versus optimization choices" +
        "2. Examine how core algorithms and architectures are implemented in the code\n. Trace the execution flow of any key components, noting any parameter, constants or design choices in the code. Think step-by-step when analysing the code" +
        "3. Note any discrepancies between paper descriptions and code implementation\n\n" +
        "## Discrepancy Classification\n" +
        "Classify discrepancies as:\n" +
        "- **Critical**: Prevent reproduction of core claims/methodology\n" +
        "- **Minor**: May affect performance but not fundamental approach\n" +
        "- **Cosmetic**: Documentation differences with minimal impact\n\n" +
        "## Output Format\n" +
        "1. Brief paper summary and core claims\n" +
        "2. Implementation assessment\n" +
        "3. Categorized discrepancies (if any)\n" +
        "4. Overall reproducibility conclusion\n\n" +
        "Remember that research code often differs from paper descriptions in minor ways. Focus on whether the implementation preserves the fundamental approach rather than perfect correspondence."
    );
    
    console.log(`Analyzing paper "${pdfName}" with code from "${zipName}" using Gemini API...`);
    
    try {
        // Construct the parts for Gemini API
        const requestParts = [
            {
                inlineData: {
                    mimeType: "application/pdf",
                    data: pdfData
                }
            },
            { text: "The above is a research paper. I'm also providing code files and a README extracted from a zip archive that is supposed to accompany this paper:\n\n" }
        ];

        // Add each code file
        for (const file of codeFiles) {
            requestParts.push({ text: `File: ${file.name}\nLanguage: ${file.language}\n\`\`\`\n${file.content}\n\`\`\`\n\n` });
        }
        
        // Add the README content
        if (readmeContent && readmeContent.trim() !== "") {
            requestParts.push({ text: `README Content:\n${readmeContent}\n\n` });
        } else {
            requestParts.push({ text: `No README content found in the ZIP archive.\n\n` });
        }
        requestParts.push({ text: `---\n\nANALYSIS TASK:\n\n${prompt}` });
        
        const generationConfig = {
            temperature: 0.5,
            maxOutputTokens: 20000, // Increased from default, adjust as needed based on Gemini Pro capabilities
        };

        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ];

        // Send request to Gemini API
        const result = await model.generateContent({
            contents: [{ role: "user", parts: requestParts }],
            generationConfig,
            safetySettings
        });
        
        const response = result.response;
        let responseText = "";

        if (response && response.candidates && response.candidates.length > 0) {
            if (response.candidates[0].content && response.candidates[0].content.parts && response.candidates[0].content.parts.length > 0) {
                responseText = response.candidates[0].content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join("");
            } else if (response.candidates[0].finishReason === "SAFETY") {
                console.warn("Gemini response blocked due to safety reasons.");
                responseText = "Response blocked by safety settings. Please try a different input or contact support if this seems incorrect.";
            } else {
                 responseText = "No text content found in Gemini response candidate.";
                 console.warn("Gemini response structure:", JSON.stringify(response.candidates[0], null, 2));
            }
        } else {
            responseText = "No response candidates received from Gemini.";
            if (response && response.promptFeedback) {
                console.warn("Prompt feedback from Gemini:", JSON.stringify(response.promptFeedback, null, 2));
                responseText += ` Prompt Feedback: ${response.promptFeedback.blockReason || 'Unknown reason'}`;
                 if (response.promptFeedback.blockReason === 'SAFETY') {
                    responseText = "Request blocked by safety settings due to prompt content. Please revise your input.";
                }
            }
        }
        return responseText;

    } catch (error) {
        console.error('Error analyzing with Gemini:', error);
        // Check for specific Google API error structures if available
        if (error.message && error.message.includes("API key not valid")) {
             throw new Error("Invalid Google API key. Please check server configuration.");
        }
        throw error; // Re-throw for the caller to handle
    }
}

// API endpoint to handle comparison
app.post('/api/compare', upload.fields([
    { name: 'paper', maxCount: 1 },
    { name: 'code', maxCount: 1 } // 'code' is now expected to be a ZIP file
]), async (req, res) => {
    try {
        if (!req.files || !req.files.paper || !req.files.code) {
            return res.status(400).json({ 
                error: 'Missing required files. Please upload both a research paper (PDF) and a code archive (ZIP).' 
            });
        }

        const paperPath = req.files.paper[0].path;
        const zipPath = req.files.code[0].path; // This is now the path to the uploaded ZIP file


        // Run the analysis with Gemini
        const analysisResult = await analyzeWithGemini(paperPath, zipPath);
        
        // Clean up uploaded files
        fs.unlinkSync(paperPath);
        fs.unlinkSync(zipPath);

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
    
    // Check if GOOGLE_API_KEY is set
    if (!process.env.GOOGLE_API_KEY) {
        console.warn('WARNING: GOOGLE_API_KEY environment variable is not set. The API calls will fail.');
    } else {
        console.log('Google API key found in environment variables.');
    }
});