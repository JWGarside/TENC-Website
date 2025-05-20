// DOM elements
const paperUploadInput = document.getElementById('paper-upload');
const codeUploadInput = document.getElementById('code-upload');
const paperFilename = document.getElementById('paper-filename');
const codeFilename = document.getElementById('code-filename');
const compareButton = document.getElementById('compare-button');
const loadingSection = document.getElementById('loading');
const resultsSection = document.getElementById('results-section');
const resultsContent = document.getElementById('results-content');
const errorMessage = document.getElementById('error-message');

// File storage
let paperFile = null;
let codeFile = null;

// Event listeners
paperUploadInput.addEventListener('change', handlePaperUpload);
codeUploadInput.addEventListener('change', handleCodeUpload);
compareButton.addEventListener('click', runComparison);

function handlePaperUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        paperFile = file;
        paperFilename.textContent = file.name;
        checkFilesAndEnableButton();
        hideError();
    } else {
        paperFile = null;
        paperFilename.textContent = "Invalid file. Please upload a PDF.";
        showError("Please upload a valid PDF file for the research paper.");
        checkFilesAndEnableButton();
    }
}

function handleCodeUpload(event) {
    const file = event.target.files[0];
    if (file) {
        // Check for .zip extension or zip MIME types
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        const isZip = fileExt === '.zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
        
        if (isZip) {
            codeFile = file;
            codeFilename.textContent = file.name;
            checkFilesAndEnableButton();
            hideError();
        } else {
            codeFile = null;
            codeFilename.textContent = "Invalid file. Please upload a ZIP archive.";
            showError("Please upload a valid ZIP archive (.zip) for the code.");
            checkFilesAndEnableButton();
        }
    }
}

function checkFilesAndEnableButton() {
    compareButton.disabled = !(paperFile && codeFile);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    if (paperFile && codeFile) {
        errorMessage.style.display = 'none';
    }
}

async function runComparison() {
    // Reset previous results
    resultsContent.textContent = '';
    resultsSection.style.display = 'none';
    
    // Show loading indicator
    loadingSection.style.display = 'block';
    
    try {
        // Create FormData object to send files
        const formData = new FormData();
        formData.append('paper', paperFile);
        formData.append('code', codeFile);
        
        // Send files to the backend API
        const response = await fetch('/api/compare', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Hide loading indicator
        loadingSection.style.display = 'none';
        
        // Display results
        resultsContent.innerHTML = formatResults(result.analysis);
        resultsSection.style.display = 'block';
        
        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        console.error('Error during comparison:', error);
        loadingSection.style.display = 'none';
        showError(`Error during analysis: ${error.message}`);
    }
}

function formatResults(results) {
    let summaryHtml = '';
    let mainContent = results;

    // Normalize line endings first
    mainContent = mainContent.replace(/\r\n/g, '\n');

    // Regex to find the Summary Statistics section
    // It captures "## Summary Statistics" and the list items following it.
    const summaryRegex = /^(## Summary Statistics\s*\n)((?:-\s+.*(?:\n|$))+)/m;
    const summaryMatch = mainContent.match(summaryRegex);

    if (summaryMatch) {
        const summaryHeaderText = summaryMatch[1].trim(); // Full header line e.g., "## Summary Statistics"
        const summaryItemsText = summaryMatch[2].trim();  // All list items as a single string

        // Create H2 for "Summary Statistics"
        summaryHtml = `<h2>${summaryHeaderText.replace(/^##\s*/, '')}</h2>\n<div class="summary-items">\n`;

        const items = summaryItemsText.split('\n');
        items.forEach(item => {
            const trimmedItem = item.trim();
            if (trimmedItem === '') return;

            // Expecting format like "- Label: Value"
            const itemMatch = trimmedItem.match(/-\s*(.*?):\s*(.*)/);
            if (itemMatch) {
                const label = itemMatch[1].trim();
                const value = itemMatch[2].trim();
                summaryHtml += `<p><strong>${label}:</strong> <strong>${value}</strong></p>\n`;
            } else {
                // Fallback for any line in summary not matching "Label: Value" but starting with "-"
                if (trimmedItem.startsWith('-')) {
                    summaryHtml += `<p><strong>${trimmedItem.substring(1).trim()}</strong></p>\n`;
                } else {
                    summaryHtml += `<p>${trimmedItem}</p>\n`; // Should not happen if format is followed
                }
            }
        });
        summaryHtml += '</div>\n<hr />\n'; // Add a horizontal rule after summary

        // Remove the summary part from mainContent so it's not processed again by general rules
        mainContent = mainContent.replace(summaryRegex, '').trim();
    }

    // Process the rest of the content (mainContent)
    // For best display of newlines and paragraphs from the Markdown,
    // the HTML element that receives this content should have CSS `white-space: pre-line;`.
    let processedMainContent = mainContent
        // Code blocks (```text```
        // Process first to protect their content, and escape HTML entities within.
        .replace(/```([\s\S]*?)```/g, (match, codeContent) => {
            const escapedContent = codeContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            return `<pre><code>${escapedContent}</code></pre>`;
        })

        // Headers (#, ##, ###)
        // Process from most specific (###) to least specific (#) to avoid mis-parsing.
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        
        // Lists (* item, - item)
        // Converts items to <li>. Does not wrap in <ul> with this simple regex chain.
        // Relies on CSS for styling list items (e.g., `display: list-item; margin-left: 20px;`).
        .replace(/^\s*[\*\-]\s+(.*)/gm, '<li>$1</li>')

        // Bold text (**text**)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        
        // Italic text (*text*)
        // Applied after list items are handled if '*' is used for lists.
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        
        // Inline code (`code`)
        .replace(/`(.*?)`/g, '<code>$1</code>')
        ; // End of chained replacements

    return summaryHtml + processedMainContent;
}