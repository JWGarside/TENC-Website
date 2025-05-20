// gemini_test.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai"); // Changed import
const { program } = require('commander');
// const { v4: uuidv4 } = require('uuid'); // uuid might not be needed unless for other purposes
const semanticChunking = require('./semanticChunking');

/**
 * Compare a research paper and code files/README from a zip archive using the Google Gemini API.
 * 
 * @param {string} pdfPath - Path to the PDF research paper
 * @param {string} zipPath - Path to the zip archive containing code and README
 * @param {string} outputDir - Directory to save the output file
 * @param {number} runNumber - The run number for this comparison
 * @param {string} customPrompt - Custom prompt for Gemini (uses default if null) 
 * @param {string} apiKey - Google API key (defaults to environment variable)
 * @returns {Promise<string>} - Gemini's response
 */
async function comparePaperAndCode(pdfPath, zipPath, outputDir, runNumber, customPrompt = null, apiKey = null) {
    // Initialize the Google Generative AI client
    const effectiveApiKey = "AIzaSyAfVGy4zRg9v1YE297jTWDMjp4AqvTIlOY" || process.env.GOOGLE_API_KEY;
    if (!effectiveApiKey) {
        console.error("Google API key not found. Please set GOOGLE_API_KEY environment variable or provide --api-key.");
        throw new Error("Google API key not found.");
    }
    const genAI = new GoogleGenerativeAI(effectiveApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" }); // Using Gemini 2.5 Pro preview

    // Read and encode PDF file as Base64
    const pdfData = fs.readFileSync(pdfPath).toString('base64');

    // Semantically chunk the zip archive
    const { codeFiles, readmeContent } = await semanticChunking.chunkZipArchive(zipPath);

    // Extract file names for output naming
    const pdfName = path.basename(pdfPath, path.extname(pdfPath));
    const zipName = path.basename(zipPath, path.extname(zipPath));

    // Default prompt if none provided
    const prompt = customPrompt || (
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
        requestParts.push({ text: `README Content:\n${readmeContent}\n\n---\n\nANALYSIS TASK:\n\n${prompt}` });
        
        const generationConfig = {
            temperature: 0.5,
            maxOutputTokens: 20000, // Adjust as needed
        };

        // Safety settings to reduce chances of blocked content (adjust as needed)
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
                 // Concatenate all text parts from the response
                responseText = response.candidates[0].content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join("");
            } else if (response.candidates[0].finishReason === "SAFETY") {
                console.warn("Gemini response blocked due to safety reasons. Check safetySettings or prompt content.");
                responseText = "Response blocked due to safety settings.";
            } else {
                 responseText = "No text content found in Gemini response candidate.";
                 console.warn("Gemini response structure:", JSON.stringify(response.candidates[0], null, 2));
            }
        } else {
            responseText = "No response candidates received from Gemini.";
            if (response.promptFeedback) {
                console.warn("Prompt feedback from Gemini:", JSON.stringify(response.promptFeedback, null, 2));
                responseText += ` Prompt Feedback: ${response.promptFeedback.blockReason || 'Unknown reason'}`;
            }
        }
        
        // Save result to markdown file  
        const outputFileName = `${zipName}_Run${runNumber}_Gemini.md`; // Added _Gemini
        const outputPath = path.join(outputDir, outputFileName);

        // Create markdown content
        const mdContent = `# Paper-Code Consistency Analysis (Gemini)

**Paper:** ${pdfName}  
**Code Archive:** ${zipName}
**Analysis Date:** ${new Date().toISOString().split('T')[0]}

## Analysis Results

${responseText}`;

        fs.writeFileSync(outputPath, mdContent);

        console.log(`Analysis saved to: ${outputPath}`);
        return responseText;
    } catch (error) {
        console.error('Error comparing paper and code with Gemini:', error.message);
        if (error.response) { // This might be different for Google's SDK
            console.error('API Error Details:', error.response);
        } else if (error.status && error.message) { // Common pattern for Google API errors
             console.error(`Google API Error Status: ${error.status}, Message: ${error.message}`);
        }
        throw error; 
    }
}

/**
 * Run a batch of comparisons between a paper and code zip archive multiple times.
 * 
 * @param {string} pdfPath - Path to the PDF research paper
 * @param {string} zipPath - Path to the zip archive containing code and README
 * @param {string} outputDir - Directory to save the output file
 * @param {number} numRuns - Number of times to run each comparison (default: 3)
 * @param {string} customPrompt - Custom prompt for Gemini (uses default if null)
 * @param {string} apiKey - Google Gemini API key (defaults to environment variable)
 * @returns {Promise<void>} 
 */
async function runComparisonsInBatch(pdfPath, zipPath, outputDir, numRuns = 3, customPrompt = null, apiKey = null) {
    for (let i = 1; i <= numRuns; i++) {
        console.log(`Running comparison ${i} of ${numRuns}...`);
        await comparePaperAndCode(pdfPath, zipPath, outputDir, i, customPrompt, apiKey);
    }
}

// Command line interface setup
if (require.main === module) {
    program
        .name('paper-code-compare-gemini') // Updated name
        .description('Compare a research paper and code zip archive with Google Gemini AI in batch mode') // Updated description
        .version('1.0.0')
        .requiredOption('-p, --pdf <path>', 'Path to the PDF research paper')
        .requiredOption('-z, --zip <path>', 'Path to the zip archive containing code and README') 
        .option('-o, --output-dir <path>', 'Directory to save output files', './Reproduced Papers results') // Updated default dir
        .option('-r, --runs <number>', 'Number of times to run each comparison', 3)
        .option('--prompt <text>', 'Custom prompt for Gemini (uses default if not provided)')
        .option('--api-key <key>', 'Google API key (optional, can use GOOGLE_API_KEY environment variable)') // Updated help text
        .action(async (options) => {
            try {
                // Ensure output directory exists
                if (!fs.existsSync(options.outputDir)) {
                    fs.mkdirSync(options.outputDir, { recursive: true }); 
                }

                // Run the comparisons in batch
                await runComparisonsInBatch(
                    options.pdf,
                    options.zip,  
                    options.outputDir,
                    options.runs,
                    options.prompt,
                    options.apiKey
                );

                console.log(`\nAll comparisons completed. Results saved in ${options.outputDir}`); 
            } catch (error) {
                console.error(`Error: ${error.message}`);
                process.exit(1);
            }
        });

    program.parse();  
}

module.exports = { comparePaperAndCode, runComparisonsInBatch };