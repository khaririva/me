import JSZip from 'jszip';

export const SAMPLE_BOOK_ID = 'sample-the-art-of-quiet-reading';

export async function createSampleEpubBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.folder('META-INF')?.file(
    'container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder('OEBPS');

  oebps?.file(
    'content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/opf">
    <dc:title>The Art of Quiet Reading (Buku Contoh)</dc:title>
    <dc:creator opf:role="aut">Eleanor Vance</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">${SAMPLE_BOOK_ID}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap3" href="chap3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
    <itemref idref="chap3"/>
  </spine>
</package>`
  );

  oebps?.file(
    'toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${SAMPLE_BOOK_ID}"/>
  </head>
  <docTitle><text>The Art of Quiet Reading</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>Chapter 1: Whispers of Ink</text></navLabel>
      <content src="chap1.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-2" playOrder="2">
      <navLabel><text>Chapter 2: Bridges Across Languages</text></navLabel>
      <content src="chap2.xhtml"/>
    </navPoint>
    <navPoint id="navPoint-3" playOrder="3">
      <navLabel><text>Chapter 3: The Sanctuary of Solitude</text></navLabel>
      <content src="chap3.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`
  );

  oebps?.file(
    'chap1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1: Whispers of Ink</title></head>
<body>
  <h1>Chapter 1: Whispers of Ink</h1>
  <p>In an era defined by fleeting notifications and ephemeral digital noise, sitting down with a thoughtful book becomes a quiet act of rebellion. Every sentence is a deliberate architecture of thought, inviting the reader to slow down and inhabit another mind.</p>
  <p>When we encounter unfamiliar words—such as <em>serendipity</em>, <em>ephemeral</em>, or <em>melancholy</em>—we are not merely stumbling over vocabulary; we are standing at the threshold of a new nuance of human emotion.</p>
  <p>Try highlighting any word or paragraph on this page with your trackpad. A floating menu will appear so you can translate it seamlessly into Bahasa Indonesia or save new expressions into your personal vocabulary journal.</p>
</body>
</html>`
  );

  oebps?.file(
    'chap2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2: Bridges Across Languages</title></head>
<body>
  <h1>Chapter 2: Bridges Across Languages</h1>
  <p>Translation is never a mechanical substitution of one word for another. Rather, it is the delicate art of carrying the soul of an idea across a river without spilling its resonance.</p>
  <p>Consider how a single idiom carries centuries of cultural memory. To understand a story written in another tongue is to look through a window into a landscape both foreign and deeply familiar.</p>
  <p>You can switch to <strong>Terjemahan</strong> or <strong>Bilingual</strong> mode in the top toolbar, or click <strong>Terjemahkan Buku</strong> to translate every chapter automatically and export an offline copy.</p>
</body>
</html>`
  );

  oebps?.file(
    'chap3.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 3: The Sanctuary of Solitude</title></head>
<body>
  <h1>Chapter 3: The Sanctuary of Solitude</h1>
  <p>A personal library is a sanctuary built not of stone, but of curiosity. Whether you prefer the warm glow of sepia pages late at night or the crisp clarity of daylight mode on your MacBook display, the best reading environment is one that disappears, leaving only the story behind.</p>
  <p>Drag and drop any <code>.epub</code> file directly onto this window or press <strong>Command + O</strong> to add books to your local MacBook library.</p>
</body>
</html>`
  );

  return await zip.generateAsync({ type: 'arraybuffer' });
}
