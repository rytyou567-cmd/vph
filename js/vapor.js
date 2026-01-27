/**
 * VAPOR: Markdown-to-Landing Engine
 * ViewPorts Productivity Suite
 * 
 * ROLE:
 * Converts Markdown text to styled landing pages with theme presets.
 * Uses Marked.js for parsing and generates self-contained HTML.
 * 
 * ARCHITECTURE:
 * - Parser: Marked.js for Markdown → HTML conversion
 * - Themes: 3 preset styles (Neon, Glass, Void)
 * - Export: Opens generated page in new window
 * 
 * KEY WORKFLOWS:
 * 1. INPUT: User types Markdown in editor
 * 2. THEME SELECTION: Choose visual preset (colors, gradients)
 * 3. GENERATION: Parse Markdown → Inject into HTML template → Apply theme CSS
 * 4. PREVIEW: Open in new window (live, editable HTML)
 * 
 * THEMES:
 * - NEON: Cyberpunk (cyan/magenta, radial gradient bg)
 * - GLASS: Minimalist (white text, glassmorphism)
 * - VOID: High-contrast (pure black bg, minimal decoration)
 */

const VAPOR = (() => {
    let elements = {};
    let currentTheme = 'neon';

    /**
     * INITIALIZATION: Binds the markdown editor and theme selector
     */
    function init(config) {
        elements = {
            editor: document.getElementById(config.editorId),
            themePills: document.querySelectorAll(config.themePillClass),
            generateBtn: document.getElementById(config.generateBtnId)
        };

        setupEventListeners();
        // Load default content
        elements.editor.value = `# VAPOR PROJECT\n\nWelcome to your new **High-Performance** landing page.\n\n### Core Features\n- Ultra-fast rendering\n- Futuristic themes\n- Production-ready export\n\n> "Speed is the new security."`;
    }

    /**
     * EVENT HANDLERS: Listeners for theme switching and generation
     */
    function setupEventListeners() {
        elements.themePills.forEach(pill => {
            pill.onclick = (e) => {
                elements.themePills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentTheme = pill.innerText.toLowerCase();
            };
        });

        elements.generateBtn.onclick = ignitePage;
    }

    /**
     * CORE ENGINE: Parses Markdown and constructs the landing page HTML
     * 
     * WORKFLOW:
     * 1. Extract raw Markdown from editor
     * 2. Parse via Marked.js
     * 3. Inject into localized HTML template with current theme styles
     * 4. Launch result in a new window context
     */
    function ignitePage() {
        const markdown = elements.editor.value;
        if (!markdown) return;

        // Check if marked is available
        if (typeof marked === 'undefined') {
            alert('Marked.js core not detected in current sector.');
            return;
        }

        const html = marked.parse(markdown);

        // Construct the landing page preview
        const fullHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;700&display=swap" rel="stylesheet">
                <style>
                    body {
                        margin: 0;
                        padding: 40px;
                        background: ${getThemeBG()};
                        color: ${getThemeColor()};
                        font-family: 'Rajdhani', sans-serif;
                        transition: 1s ease;
                    }
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 40px;
                        border: 1px solid ${getThemeBorder()};
                        background: rgba(0,0,0,0.4);
                        backdrop-filter: blur(10px);
                        border-radius: 20px;
                        box-shadow: 0 0 30px ${getThemeShadow()};
                    }
                    h1 { font-size: 3.5rem; color: ${getThemeColor()}; text-transform: uppercase; letter-spacing: 5px; }
                    h3 { color: ${getThemeAccent()}; }
                    ul { list-style: none; padding: 0; }
                    li { margin: 15px 0; padding-left: 20px; border-left: 2px solid ${getThemeAccent()}; }
                    blockquote { font-style: italic; opacity: 0.7; border-left: 4px solid #fff; padding-left: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    ${html}
                </div>
            </body>
            </html>
        `;

        const win = window.open('', '_blank');
        win.document.write(fullHTML);
        win.document.close();
    }

    /**
     * THEME CONFIGURATORS: Retrieve color/style tokens for selected theme
     */
    function getThemeBG() {
        if (currentTheme === 'neon') return 'radial-gradient(circle at top left, #050510, #100015)';
        if (currentTheme === 'glass') return '#1a1a1a';
        if (currentTheme === 'void') return '#000000';
    }

    function getThemeColor() {
        if (currentTheme === 'neon') return '#00d5ff';
        if (currentTheme === 'glass') return '#f0f0f0';
        if (currentTheme === 'void') return '#ffffff';
    }

    function getThemeBorder() {
        if (currentTheme === 'neon') return 'rgba(0, 213, 255, 0.4)';
        if (currentTheme === 'glass') return 'rgba(255, 255, 255, 0.1)';
        if (currentTheme === 'void') return 'rgba(255, 255, 255, 0.2)';
    }

    function getThemeAccent() {
        if (currentTheme === 'neon') return '#ff00cc';
        if (currentTheme === 'glass') return '#00ff80';
        if (currentTheme === 'void') return '#888';
    }

    function getThemeShadow() {
        if (currentTheme === 'neon') return 'rgba(0, 213, 255, 0.2)';
        if (currentTheme === 'glass') return 'rgba(255, 255, 255, 0.05)';
        if (currentTheme === 'void') return 'rgba(255, 255, 255, 0.1)';
    }

    /**
     * RESET: Restores default content and theme
     */
    function reset() {
        elements.editor.value = '';
        currentTheme = 'neon';
        elements.themePills.forEach(p => p.classList.remove('active'));
        if (elements.themePills[0]) elements.themePills[0].classList.add('active');
    }

    return { init, reset };
})();

window.VAPOR = VAPOR;
