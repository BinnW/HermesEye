const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
process.chdir(path.resolve(__dirname, '../../..'));
const master = fs.readFileSync('docs/design/brand/hermeseye-icon.svg', 'utf8');
const foreground = master.replace(/  <rect id="background"[^>]+\/>\n/, '');
const backgroundRect = master.match(/<rect id="background"[^>]+\/>/);
if (!backgroundRect) { throw new Error('SVG缺少背景层'); }
const background = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' + backgroundRect[0] + '</svg>';
const rounded = master.replace('<rect id="background"', '<rect rx="224" id="background"');
(async () => {
  for (const root of ['AppScope/resources/base/media', 'entry/src/main/resources/base/media']) {
    await sharp(Buffer.from(foreground)).png().toFile(root + '/hermes_foreground.png');
    await sharp(Buffer.from(background)).png().toFile(root + '/hermes_background.png');
  }
  await sharp(Buffer.from(rounded)).resize(256).png().toFile('entry/src/main/resources/base/media/hermes_start.png');
  await sharp(Buffer.from(rounded)).resize(512).png().toFile('docs/design/brand/hermeseye-icon.png');
})().catch((error) => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
