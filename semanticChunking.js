// semanticChunking.js
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

/**
 * Decompresses a ZIP archive containing code files and processes them into semantic chunks
 * 
 * @param {string} zipFilePath - Path to the ZIP archive containing code files
 * @returns {Promise<Array>} - Array of objects with file information and semantic chunks
 */
async function processCodeZip(zipFilePath) {
  try {
    // Create a temporary directory to extract files
    const extractDir = path.join(__dirname, 'temp', `extract-${uuidv4()}`);
    await fs.mkdir(extractDir, { recursive: true });
    
    // Read and extract the ZIP file
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(extractDir, true);
    
    // Get all extracted files
    const processedFiles = [];
    const allFiles = await getAllFiles(extractDir);
    
    // Filter for code files and README files based on extension
    const validExtensions = ['.py', '.js', '.cpp', '.java', '.r', '.c', '.h', '.ipynb', '.m', '.md'];
    const validFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return validExtensions.includes(ext);
    });
    
    // Separate README files from code files
    const readmeFiles = validFiles.filter(isReadmeFile);
    const codeFiles = validFiles.filter(file => !isReadmeFile(file));
    
    // Process each code file
    for (const filePath of codeFiles) {
      const relPath = path.relative(extractDir, filePath);
      const fileExt = path.extname(filePath).slice(1); // Remove the dot
      const fileContent = await fs.readFile(filePath, 'utf-8');
      
      // Split the file into semantic chunks
      const chunks = splitIntoSemanticChunks(fileContent, fileExt);
      
      processedFiles.push({
        relativePath: relPath,
        extension: fileExt,
        language: getLanguageFromExtension(fileExt),
        originalSize: fileContent.length,
        type: 'code',
        chunks
      });
    }
    
    // Process each README file
    for (const filePath of readmeFiles) {
      const relPath = path.relative(extractDir, filePath);
      const fileExt = path.extname(filePath).slice(1); // Remove the dot
      const fileContent = await fs.readFile(filePath, 'utf-8');
      
      processedFiles.push({
        relativePath: relPath,
        extension: fileExt,
        language: 'Markdown',
        originalSize: fileContent.length,
        type: 'readme',
        content: fileContent // Store the full content without chunking
      });
    }
    
    // Clean up the temporary directory
    await fs.rm(extractDir, { recursive: true, force: true });
    
    return processedFiles;
  } catch (error) {
    console.error('Error processing ZIP archive:', error);
    throw error;
  }
}

/**
 * Recursively gets all files in a directory
 * 
 * @param {string} dir - Directory to scan
 * @returns {Promise<Array<string>>} - Array of file paths
 */
async function getAllFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? getAllFiles(fullPath) : fullPath;
  }));
  
  return files.flat();
}

/**
 * Splits code content into semantic chunks based on code structure
 * 
 * @param {string} content - File content
 * @param {string} fileExt - File extension
 * @returns {Array<object>} - Array of content chunks with metadata
 */
function splitIntoSemanticChunks(content, fileExt) {
  // Define language-specific patterns for identifying structural elements
  const patterns = {
    'py': {
      classPattern: /^\s*class\s+\w+/,
      functionPattern: /^\s*def\s+\w+/,
      importPattern: /^\s*(import|from)\s+/,
      commentPattern: /^\s*#/
    },
    'js': {
      classPattern: /^\s*(class|const|let|var)?\s*(\w+)\s*=?\s*class/,
      functionPattern: /^\s*(function|const|let|var)?\s*(\w+\s*=\s*)?(async\s*)?\s*(\w+\s*\(|\(\s*\)\s*=>)/,
      importPattern: /^\s*(import|require|export)/,
      commentPattern: /^\s*(\/\/|\/\*)/
    },
    'cpp': {
      classPattern: /^\s*(class|struct)\s+\w+/,
      functionPattern: /^\s*(\w+(\s*<.*>)?\s+)?\w+\s*\([^)]*\)\s*({|$)/,
      includePattern: /^\s*#include/,
      commentPattern: /^\s*(\/\/|\/\*)/
    },
    'java': {
      classPattern: /^\s*(public|private|protected)?\s*(static)?\s*(final)?\s*class\s+\w+/,
      functionPattern: /^\s*(public|private|protected)?\s*(static)?\s*(\w+(\s*<.*>)?\s+)?\w+\s*\(/,
      importPattern: /^\s*import\s+/,
      commentPattern: /^\s*(\/\/|\/\*)/
    },
    'r': {
      functionPattern: /^\s*(\w+)\s*<-\s*function\s*\(/,
      commentPattern: /^\s*#/
    }
  };
  
  // Default patterns for any unsupported language
  const defaultPatterns = {
    classPattern: /class|struct/,
    functionPattern: /function|\w+\s*\(/,
    importPattern: /import|include|require/,
    commentPattern: /[#\/]/
  };
  
  // Get the appropriate patterns for the file type
  const langPatterns = patterns[fileExt] || defaultPatterns;
  
  // Split the content into lines for analysis
  const lines = content.split('\n');
  const chunks = [];
  
  // First identify a header/imports section
  let headerEndLine = 0;
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    if (langPatterns.importPattern?.test(lines[i]) || 
        langPatterns.commentPattern?.test(lines[i]) || 
        lines[i].trim() === '') {
      headerEndLine = i + 1;
    } else if (headerEndLine > 0) {
      // Break on first non-comment, non-empty, non-import line after finding imports
      break;
    }
  }
  
  // If we have a header, create a chunk for it
  if (headerEndLine > 0) {
    chunks.push({
      content: lines.slice(0, headerEndLine).join('\n'),
      startLine: 1,
      endLine: headerEndLine,
      type: 'header'
    });
  }
  
  // Function to identify code block boundaries (handles indentation)
  function findBlockEnd(startLine, indentLevel) {
    // For languages like Python where indentation matters
    const isPythonLike = fileExt === 'py';
    
    // If no indent level provided, calculate from the first line
    const baseIndent = indentLevel !== undefined ? 
      indentLevel : 
      lines[startLine].match(/^\s*/)[0].length;
    
    let end = startLine;
    let foundNonEmptyLine = false;
    
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip empty lines
      if (line.trim() === '') {
        end = i;
        continue;
      }
      
      foundNonEmptyLine = true;
      const currentIndent = line.match(/^\s*/)[0].length;
      
      // For Python-like languages, we use indentation to determine block end
      if (isPythonLike) {
        if (currentIndent <= baseIndent && line.trim() !== '') {
          return end;
        }
      } 
      // For braced languages, we need to track opening and closing braces
      else {
        // If we find a closing brace at the same indent level, this might be our block end
        if (line.trim() === '}' && currentIndent <= baseIndent) {
          return i;
        }
        
        // If we find a line with lower indentation that's not a continuation
        // and not a closing brace, we might have exited the block
        if (currentIndent < baseIndent && !line.trim().startsWith('.') && 
            !line.trim().startsWith(')') && !line.trim().startsWith('}')) {
          return end;
        }
      }
      
      end = i;
    }
    
    return end;
  }
  
  // Process the rest of the file to find structural elements
  let currentLine = headerEndLine;
  
  while (currentLine < lines.length) {
    const line = lines[currentLine];
    
    // Skip empty lines
    if (line.trim() === '') {
      currentLine++;
      continue;
    }
    
    let chunkStart = currentLine;
    let chunkType = 'other'; // Default type
    
    // Check if line defines a class
    if (langPatterns.classPattern?.test(line)) {
      const blockEnd = findBlockEnd(currentLine);
      
      chunks.push({
        content: lines.slice(chunkStart, blockEnd + 1).join('\n'),
        startLine: chunkStart + 1,
        endLine: blockEnd + 1,
        type: 'class'
      });
      
      currentLine = blockEnd + 1;
      continue;
    }
    
    // Check if line defines a function
    if (langPatterns.functionPattern?.test(line)) {
      const blockEnd = findBlockEnd(currentLine);
      
      chunks.push({
        content: lines.slice(chunkStart, blockEnd + 1).join('\n'),
        startLine: chunkStart + 1,
        endLine: blockEnd + 1,
        type: 'function'
      });
      
      currentLine = blockEnd + 1;
      continue;
    }
    
    // If we get here, this line isn't the start of a recognized structure
    // Find the next structure start
    let nextStructureStart = currentLine + 1;
    while (nextStructureStart < lines.length) {
      if ((langPatterns.classPattern?.test(lines[nextStructureStart]) || 
           langPatterns.functionPattern?.test(lines[nextStructureStart])) &&
           !langPatterns.commentPattern?.test(lines[nextStructureStart])) {
        break;
      }
      nextStructureStart++;
      
      // If we reached end of file, include all remaining lines
      if (nextStructureStart >= lines.length) {
        nextStructureStart = lines.length;
        break;
      }
    }
    
    // If we have code between structures, create a chunk for it
    if (nextStructureStart > currentLine) {
      chunks.push({
        content: lines.slice(currentLine, nextStructureStart).join('\n'),
        startLine: currentLine + 1,
        endLine: nextStructureStart,
        type: 'other'
      });
      
      currentLine = nextStructureStart;
    } else {
      // Safety increment to prevent infinite loops
      currentLine++;
    }
  }
  
  return chunks;
}

/**
 * Maps file extension to programming language name
 * 
 * @param {string} extension - File extension without dot
 * @returns {string} - Programming language name
 */
function getLanguageFromExtension(extension) {
  const extensionMap = {
    'py': 'Python',
    'js': 'JavaScript',
    'cpp': 'C++',
    'java': 'Java',
    'r': 'R',
    'c': 'C',
    'h': 'C/C++ Header',
    'ipynb': 'Jupyter Notebook',
    'm': 'MATLAB'
  };
  
  return extensionMap[extension.toLowerCase()] || 'Unknown';
}

/**
 * Checks if a file is a README file
 * 
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if the file is a README file
 */
function isReadmeFile(filePath) {
  const fileName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  
  return (fileName === 'readme.md' || 
          fileName.startsWith('readme.') || 
          fileName.startsWith('read.me') || 
          (fileName.includes('readme') && ext === '.md'));
}

/**
 * Processes a ZIP archive and returns code files and README content
 * in the format expected by the paper_code_compare_batch.js script
 * 
 * @param {string} zipFilePath - Path to the ZIP archive
 * @returns {Promise<Object>} - Object containing codeFiles array and readmeContent string
 */
async function chunkZipArchive(zipFilePath) {
  try {
    // Use the existing function to process the ZIP file
    const processedFiles = await processCodeZip(zipFilePath);
    
    // Extract README files
    const readmeFiles = processedFiles.filter(file => file.type === 'readme');
    const readmeContent = readmeFiles.length > 0 ? readmeFiles
      .map(file => `# ${file.relativePath}\n\n${file.content}`)
      .join('\n\n') : "No README file found";
    
    // Format code files as expected by the batch script
    const codeFiles = processedFiles
      .filter(file => file.type === 'code')
      .map(file => ({
        name: file.relativePath,
        language: file.language,
        content: file.chunks.map(chunk => chunk.content).join('\n\n')
      }));
    
    return { codeFiles, readmeContent };
  } catch (error) {
    console.error('Error in chunkZipArchive:', error);
    throw error;
  }
}

/**
 * Example usage function to demonstrate the API
 * 
 * @param {string} zipPath - Path to the ZIP archive
 */
async function example(zipPath) {
  try {
    const processedFiles = await processCodeZip(zipPath);
    console.log(`Processed ${processedFiles.length} files from ZIP archive`);
    
    for (const file of processedFiles) {
      console.log(`\nFile: ${file.relativePath} (${file.language})`);
      console.log(`Original size: ${file.originalSize} bytes`);
      
      if (file.type === 'code') {
        console.log(`Chunks: ${file.chunks.length}`);
        
        for (const chunk of file.chunks) {
          console.log(`  Chunk: ${chunk.type} (Lines ${chunk.startLine}-${chunk.endLine})`);
          // Print the first line as a preview
          const firstLine = chunk.content.split('\n')[0].trim();
          console.log(`  Preview: ${firstLine.substring(0, 50)}${firstLine.length > 50 ? '...' : ''}`);
        }
      } else if (file.type === 'readme') {
        console.log(`Type: README file`);
        // Print the first line as a preview
        const firstLine = file.content.split('\n')[0].trim();
        console.log(`  Preview: ${firstLine.substring(0, 50)}${firstLine.length > 50 ? '...' : ''}`);
      }
    }
  } catch (error) {
    console.error('Error in example usage:', error);
  }
}

module.exports = {
  processCodeZip,
  getAllFiles,
  splitIntoSemanticChunks,
  isReadmeFile,
  chunkZipArchive // Add the new function to exports
};