# Paper-Code Comparison Web Tool

A web interface for comparing research papers with their code implementations to assess reproducibility and identify discrepancies.

## Quick Start

### Prerequisites
- **Node.js** (version 16 or higher)
- **Google Gemini API key** (get from [Google AI Studio](https://aistudio.google.com/))

### Installation

1. **Clone and install dependencies:**
```bash
git clone [your-repo-url]
cd [repo-name]
npm install
```

2. **Set up your API key:**
```bash
# Option 1: Environment variable
export GOOGLE_API_KEY="your-google-api-key"

# Option 2: Create .env file
echo "GOOGLE_API_KEY=your-google-api-key" > .env
```

3. **Run the application:**
```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

4. **Open your browser:**
Navigate to `http://localhost:3000`

## File Structure & Customisation

```
├── server.js              # Main Express server
├── package.json           # Dependencies and scripts
├── semanticChunking.js     # Code analysis logic
├── public/
│   ├── index.html         # Main web interface
│   └── script.js          # Frontend JavaScript
├── uploads/               # Temporary file storage (auto-created)
└── .env                   # API keys (create this)
```

### Should you wish to configure anything

**Change AI Model (`server.js` line 77):**
```javascript
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" });
```

**Modify Prompt (`server.js` lines 90-110):**
Update the prompt variable to test how papers and code are analysed.

**Adjust File Limits (`server.js` lines 35-36):**
```javascript
limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit, sort of arbitrary
```

**Update UI Styling (`public/index.html` lines 10-200):**
CSS styles are embedded in the HTML file for easy customisation. Go ahead and play with these styles.

## Deployment options to tinker with this

### Local Development
```bash
npm run dev
# Access at http://localhost:3000
```
**Manual Server:**
1. Install Node.js on your server
2. Run `npm install && npm start`
3. Configure reverse proxy (nginx/Apache) if needed

## How It Works

1. **Upload**: Users upload PDF (paper) + ZIP (code) via web interface
2. **Processing**: `semanticChunking.js` extracts and organises code files
3. **Analysis**: `server.js` sends paper + code to Google Gemini API
4. **Results**: Analysis returned as formatted text to user

## API Usage

The tool uses a single endpoint:

```javascript
POST /api/compare
Content-Type: multipart/form-data

Fields:
- paper: PDF file
- code: ZIP archive
```

## Supported File Types

- **Papers**: PDF only
- **Code**: ZIP archives containing:
  - Python (.py)
  - JavaScript (.js) 
  - C/C++ (.c, .cpp, .h)
  - Java (.java)
  - R (.r)
  - MATLAB (.m)
  - Jupyter (.ipynb)
  - README files (.md)

## Security Notes

- Files are temporarily stored in `uploads/` and deleted after processing
- No permanent data storage
- API keys should be kept secure (use environment variables)
- Consider rate limiting for production use

## Troubleshooting

**"API key not found" error:**
- Verify `GOOGLE_API_KEY` is set correctly
- Check `.env` file exists and is properly formatted

**File upload failures:**
- Check file size limits (default 500MB)
- Ensure PDF/ZIP file formats are correct

**Port conflicts:**
- Default port is 3000, change in `server.js` or set `PORT` environment variable

## Related Repositories

For detailed case studies and command-line analysis tools, see: [link to your CS1/CS2 repository]

## License

[MIT]
