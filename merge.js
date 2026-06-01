const fs = require('fs');

const oldSchema = fs.readFileSync('schema.head.utf8.prisma', 'utf8');
const newSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const getBlocks = (schema) => {
  const blocks = {};
  const lines = schema.split('\n');
  let currentBlock = null;
  let currentName = null;
  let currentContent = [];

  for (let line of lines) {
    const match = line.match(/^(model|enum)\s+(\w+)/);
    if (match) {
      currentBlock = match[1];
      currentName = match[2].toLowerCase();
      currentContent = [line];
    } else if (currentBlock) {
      currentContent.push(line);
      if (line.trim() === '}') {
        blocks[currentName] = currentContent.join('\n');
        currentBlock = null;
      }
    }
  }
  return blocks;
};

const oldBlocks = getBlocks(oldSchema);
const newBlocks = getBlocks(newSchema);

let mergedSchema = oldSchema;

let addedCount = 0;
for (const [name, content] of Object.entries(newBlocks)) {
  if (!oldBlocks[name]) {
    mergedSchema += '\n\n' + content;
    addedCount++;
    console.log('Added new block: ' + name);
  }
}

// Fix yeastarExt typo in User model
mergedSchema = mergedSchema.replace(/yeasterExt/g, 'yeastarExt');

fs.writeFileSync('prisma/schema.prisma', mergedSchema);
console.log('Merged ' + addedCount + ' new blocks successfully!');
