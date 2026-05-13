// Component library — categorized draggable blocks
window.Blocks = (function() {
  const blocks = [
    // ---- Typography ----
    { cat: 'Typography', name: 'Heading 1', icon: 'H1', html: '<h1>Heading 1</h1>' },
    { cat: 'Typography', name: 'Heading 2', icon: 'H2', html: '<h2>Heading 2</h2>' },
    { cat: 'Typography', name: 'Heading 3', icon: 'H3', html: '<h3>Heading 3</h3>' },
    { cat: 'Typography', name: 'Paragraph', icon: '¶', html: '<p>Write something thoughtful here. Click to edit.</p>' },
    { cat: 'Typography', name: 'Blockquote', icon: '❝', html: '<blockquote style="border-left:4px solid #6c8cff;padding:8px 16px;margin:16px 0;color:#444;">A meaningful quote.</blockquote>' },
    { cat: 'Typography', name: 'Code', icon: '<>', html: '<pre style="background:#1d2230;color:#e7ebf3;padding:14px;border-radius:8px;overflow:auto;font-family:ui-monospace,monospace;"><code>console.log("hello");</code></pre>' },
    { cat: 'Typography', name: 'Inline code', icon: '`', html: '<code style="background:#eee;padding:2px 6px;border-radius:4px;font-family:ui-monospace,monospace;">code</code>' },
    { cat: 'Typography', name: 'Divider', icon: '—', html: '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">' },

    // ---- Layout ----
    { cat: 'Layout', name: 'Container', icon: '▭', html: '<div style="max-width:1100px;margin:0 auto;padding:24px;">Container</div>' },
    { cat: 'Layout', name: 'Section', icon: '⬚', html: '<section style="padding:48px 24px;"><div style="max-width:1100px;margin:0 auto;"><h2>Section title</h2><p>Section content goes here.</p></div></section>' },
    { cat: 'Layout', name: '2 columns', icon: '⫴', html: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;"><div>Column one</div><div>Column two</div></div>' },
    { cat: 'Layout', name: '3 columns', icon: '⫶', html: '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;padding:24px;"><div>Col 1</div><div>Col 2</div><div>Col 3</div></div>' },
    { cat: 'Layout', name: 'Flex row', icon: '⇆', html: '<div style="display:flex;gap:16px;align-items:center;padding:16px;"><div>Item 1</div><div>Item 2</div><div>Item 3</div></div>' },
    { cat: 'Layout', name: 'Flex column', icon: '⇅', html: '<div style="display:flex;flex-direction:column;gap:16px;padding:16px;"><div>Stack 1</div><div>Stack 2</div></div>' },
    { cat: 'Layout', name: 'Spacer', icon: '↕', html: '<div style="height:48px;"></div>' },

    // ---- Components ----
    { cat: 'Components', name: 'Button', icon: '⬜', html: '<button style="padding:10px 20px;background:#4f6ef0;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Click me</button>' },
    { cat: 'Components', name: 'Link', icon: '🔗', html: '<a href="#" style="color:#4f6ef0;text-decoration:underline;">A link</a>' },
    { cat: 'Components', name: 'Card', icon: '🗂', html: '<div style="background:white;border:1px solid #e3e6ed;border-radius:12px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,0.04);max-width:360px;"><h3 style="margin:0 0 8px;">Card title</h3><p style="margin:0;color:#5a6478;">A short description of what this card contains.</p></div>' },
    { cat: 'Components', name: 'Hero', icon: '✨', html: '<section style="padding:96px 24px;text-align:center;background:linear-gradient(135deg,#6c8cff,#8b6cff);color:white;"><h1 style="font-size:48px;margin:0 0 16px;font-weight:700;">Big idea</h1><p style="font-size:18px;margin:0 0 24px;opacity:0.9;">A supporting sentence that explains the big idea.</p><button style="padding:12px 24px;background:white;color:#4f6ef0;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Get started</button></section>' },
    { cat: 'Components', name: 'CTA banner', icon: '📣', html: '<div style="background:#1a1f2c;color:white;padding:32px 24px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;"><div><h3 style="margin:0 0 4px;">Ready to ship?</h3><p style="margin:0;opacity:0.8;">Try it free for 14 days.</p></div><button style="padding:10px 20px;background:#4f6ef0;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Start trial</button></div>' },
    { cat: 'Components', name: 'Feature row', icon: '★', html: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:32px;padding:48px 24px;"><div><div style="font-size:32px;margin-bottom:12px;">⚡</div><h3 style="margin:0 0 8px;">Fast</h3><p style="margin:0;color:#5a6478;">Built for speed.</p></div><div><div style="font-size:32px;margin-bottom:12px;">🛡</div><h3 style="margin:0 0 8px;">Secure</h3><p style="margin:0;color:#5a6478;">Encrypted end-to-end.</p></div><div><div style="font-size:32px;margin-bottom:12px;">🎯</div><h3 style="margin:0 0 8px;">Focused</h3><p style="margin:0;color:#5a6478;">No bloat, just what you need.</p></div></div>' },
    { cat: 'Components', name: 'Stat', icon: '📊', html: '<div style="text-align:center;padding:16px;"><div style="font-size:42px;font-weight:700;color:#4f6ef0;">99%</div><div style="color:#5a6478;font-size:13px;">Uptime</div></div>' },
    { cat: 'Components', name: 'Badge', icon: '🏷', html: '<span style="display:inline-block;padding:3px 10px;background:#e3e9ff;color:#4f6ef0;border-radius:12px;font-size:12px;font-weight:600;">New</span>' },
    { cat: 'Components', name: 'Alert', icon: '⚠', html: '<div style="padding:12px 16px;background:#fef3c7;border-left:4px solid #f0b86e;border-radius:6px;color:#7a4f00;">Heads up — important info goes here.</div>' },

    // ---- Media ----
    { cat: 'Media', name: 'Image', icon: '🖼', html: '<img src="https://picsum.photos/600/400" alt="Placeholder" style="max-width:100%;height:auto;display:block;border-radius:8px;">' },
    { cat: 'Media', name: 'Video', icon: '🎬', html: '<video controls style="max-width:100%;border-radius:8px;"><source src="" type="video/mp4">Your browser does not support video.</video>' },
    { cat: 'Media', name: 'YouTube', icon: '▶', html: '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:8px;overflow:hidden;"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div>' },
    { cat: 'Media', name: 'Audio', icon: '🎵', html: '<audio controls style="width:100%;"><source src="" type="audio/mpeg">Your browser does not support audio.</audio>' },
    { cat: 'Media', name: 'Figure', icon: '🖼❜', html: '<figure style="margin:24px 0;"><img src="https://picsum.photos/700/400" alt="" style="max-width:100%;height:auto;display:block;border-radius:8px;"><figcaption style="margin-top:8px;color:#5a6478;font-size:13px;text-align:center;">Image caption</figcaption></figure>' },

    // ---- Lists ----
    { cat: 'Lists', name: 'Bullet list', icon: '•', html: '<ul style="padding-left:24px;line-height:1.7;"><li>First item</li><li>Second item</li><li>Third item</li></ul>' },
    { cat: 'Lists', name: 'Numbered list', icon: '1.', html: '<ol style="padding-left:24px;line-height:1.7;"><li>Step one</li><li>Step two</li><li>Step three</li></ol>' },
    { cat: 'Lists', name: 'Definition list', icon: '≡', html: '<dl><dt style="font-weight:600;">Term</dt><dd style="margin:0 0 12px 16px;color:#5a6478;">Definition of the term.</dd></dl>' },

    // ---- Forms ----
    { cat: 'Forms', name: 'Form', icon: '📝', html: '<form style="display:flex;flex-direction:column;gap:12px;max-width:400px;"><input type="text" placeholder="Your name" style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;"><input type="email" placeholder="Email" style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;"><textarea placeholder="Message" rows="4" style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;"></textarea><button type="submit" style="padding:10px 16px;background:#4f6ef0;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;">Submit</button></form>' },
    { cat: 'Forms', name: 'Text input', icon: '⌨', html: '<input type="text" placeholder="Type here…" style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;width:240px;">' },
    { cat: 'Forms', name: 'Textarea', icon: '☰', html: '<textarea placeholder="Multi-line…" rows="4" style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;width:100%;max-width:400px;resize:vertical;"></textarea>' },
    { cat: 'Forms', name: 'Select', icon: '▼', html: '<select style="padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;"><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>' },
    { cat: 'Forms', name: 'Checkbox', icon: '☑', html: '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox"> Check me</label>' },
    { cat: 'Forms', name: 'Radio', icon: '◉', html: '<div style="display:flex;flex-direction:column;gap:6px;"><label style="display:inline-flex;align-items:center;gap:8px;"><input type="radio" name="r"> One</label><label style="display:inline-flex;align-items:center;gap:8px;"><input type="radio" name="r"> Two</label></div>' },

    // ---- Navigation ----
    { cat: 'Navigation', name: 'Navbar', icon: '☰', html: '<nav style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:white;border-bottom:1px solid #e3e6ed;"><div style="font-weight:700;font-size:18px;">Brand</div><div style="display:flex;gap:24px;"><a href="#" style="color:#1a1f2c;text-decoration:none;">Home</a><a href="#" style="color:#1a1f2c;text-decoration:none;">About</a><a href="#" style="color:#1a1f2c;text-decoration:none;">Contact</a></div></nav>' },
    { cat: 'Navigation', name: 'Footer', icon: '⬛', html: '<footer style="padding:32px 24px;background:#1a1f2c;color:#aaa;text-align:center;font-size:13px;">© 2026 Your company · <a href="#" style="color:#aaa;">Privacy</a> · <a href="#" style="color:#aaa;">Terms</a></footer>' },
    { cat: 'Navigation', name: 'Breadcrumbs', icon: '›', html: '<nav style="display:flex;gap:6px;font-size:13px;color:#5a6478;"><a href="#" style="color:inherit;">Home</a><span>›</span><a href="#" style="color:inherit;">Category</a><span>›</span><span>Current</span></nav>' },

    // ---- Tables ----
    { cat: 'Tables', name: 'Table', icon: '⊞', html: '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f6f7f9;"><th style="padding:10px;text-align:left;border-bottom:1px solid #ddd;">Name</th><th style="padding:10px;text-align:left;border-bottom:1px solid #ddd;">Value</th></tr></thead><tbody><tr><td style="padding:10px;border-bottom:1px solid #eee;">Item A</td><td style="padding:10px;border-bottom:1px solid #eee;">42</td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee;">Item B</td><td style="padding:10px;border-bottom:1px solid #eee;">7</td></tr></tbody></table>' },

    // ---- Raw ----
    { cat: 'Raw', name: 'Empty div', icon: '◻', html: '<div></div>' },
    { cat: 'Raw', name: 'Empty span', icon: '·', html: '<span></span>' },
    { cat: 'Raw', name: 'Custom HTML', icon: '<>', html: '<div>Custom content — edit the HTML directly</div>' },
  ];

  return blocks;
})();
