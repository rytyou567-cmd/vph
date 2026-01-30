# ViewPorts Standalone - Deployment Ready

This is a standalone version of the ViewPorts PDF suite - pure HTML, CSS, and JavaScript with no Laravel dependencies.

## 📁 Project Structure

```
ProjectFolder/
├── css/               # All stylesheets
├── js/                # All JavaScript files
├── vendor/            # Third-party libraries
├── index.html         # Main application file
├── pdfeditor.html     # Standalone PDF editor
├── bg-new.png         # Background image
└── Earth-From-Space-HD-Backgrounds-2195731056.jpg
```

## 🚀 Quick Start

### Option 1: Open Locally
Simply open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari).

### Option 2: Use Local Server
For full functionality, serve via a local web server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (http-server)
npx http-server

# Using PHP
php -S localhost:8000
```

Then visit: `http://localhost:8000`

## 🌐 Deployment Options

This standalone version can be deployed to any static hosting service:

### 1. **GitHub Pages** (Free)
```bash
# Install Git first from: https://git-scm.com/download/win
git init
git add .
git commit -m "Initial commit: ViewPorts Standalone"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/viewports.git
git push -u origin main
```

Then:
1. Go to your repository on GitHub
2. Settings → Pages
3. Source: Deploy from branch → main
4. Save
5. Your site will be live at: `https://YOUR_USERNAME.github.io/viewports`

### 2. **Netlify** (Free - Easiest)
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `ViewPorts_Standalone` folder
3. Done! Your site is live instantly.

**OR using Netlify CLI:**
```bash
npm install -g netlify-cli
netlify deploy --prod
```

### 3. **Vercel** (Free)
```bash
npm i -g vercel
vercel
```

### 4. **Hostinger** (Paid)
1. Login to hPanel
2. File Manager → public_html
3. Upload all files from `ViewPorts_Standalone`
4. Access via your domain

### 5. **AWS S3 + CloudFront**
```bash
aws s3 sync . s3://your-bucket-name --acl public-read
```

### 6. **Firebase Hosting**
```bash
npm install -g firebase-tools
firebase init hosting
firebase deploy
```

### 7. **Cloudflare Pages**
1. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Connect Git repository or upload directly
3. Deploy

## 🔧 Features Included

All client-side PDF tools work without a backend:
- ✅ PDF Editor
- ✅ PDF Compressor
- ✅ PDF Merger
- ✅ JPG to PDF Converter
- ✅ PDF to JPG Converter
- ✅ PDF to Word Converter
- ✅ Image Compressor
- ✅ Shield Redactor (PII Detection)
- ✅ Loomis (Color Palette Extractor)
- ✅ NYX Lab (SVG Motion Effects)
- ✅ VAPOR Engine
- ✅ KRYPT Vault (AES Encryption)
- ✅ ORION Viz (JSON Visualizer)
- ✅ ARTEMIS Scanner (AI Image Detection)

## 🔒 Privacy

All processing happens **locally in your browser**. No files are uploaded to any server.

## 🛠️ Initialize Git (Windows)

**Step 1: Install Git**
Download from: https://git-scm.com/download/win

**Step 2: Initialize Repository**
```powershell
# Navigate to this folder
cd path\to\ViewPorts_Standalone

# Initialize Git
git init

# Configure (first time only)
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: ViewPorts Standalone"
```

**Step 3: Push to GitHub**
```powershell
# Create new repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 📦 File Size Optimization (Optional)

To reduce deployment size:
1. Minify CSS files
2. Minify JS files
3. Optimize images (they're already included)

## 🌍 Domain Setup

After deploying to any platform:
1. Get the deployment URL
2. (Optional) Add custom domain in hosting platform settings
3. Update DNS records to point to your hosting

## 💡 Tips

- **HTTPS**: Most free hosting services provide free SSL (HTTPS) automatically
- **CDN**: Services like Netlify, Vercel, and Cloudflare include global CDN
- **Custom Domain**: You can connect your own domain on all platforms

## 🐛 Troubleshooting

**Issue: PDF tools not working**
- Serve via HTTP server (not file:// protocol)
- Ensure JavaScript is enabled in browser

**Issue: Files won't download**
- Check browser's download settings
- Allow popups for your domain

## 📝 License

Copyright © 2026 ViewPorts - Advanced Document Systems

---

**Ready to deploy!** Choose any hosting option above and share your ViewPorts suite with the world! 🚀

