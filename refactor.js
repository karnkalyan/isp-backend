const fs = require('fs');
let content = fs.readFileSync('prisma/schema.prisma', 'utf8');

const renames = {
  'messages': 'Message',
  'notices': 'Notice',
  'notifications': 'Notification',
  'tickets': 'Ticket',
  'ticket_comments': 'TicketComment',
  'task': 'Task',
  'inventoryitem': 'InventoryItem',
  'inventorylog': 'InventoryLog',
  'mapfile': 'MapFile',
  'mapfolder': 'MapFolder',
  'branch_settings': 'BranchSetting',
  'branch_invoice_ranges': 'BranchInvoiceRange',
  'packageonetimecharges': 'PackageOneTimeCharge',
  'rolepermissions': 'RolePermission',
  'package_plan_branches': 'PackagePlanBranch',
  'tr069_devices': 'Tr069Device',
  'ispsettings': 'ISPSettings',
  'userbranch': 'UserBranch'
};

for (const [oldName, newName] of Object.entries(renames)) {
  const regex = new RegExp('model ' + oldName + ' \\{', 'g');
  if (content.match(regex)) {
    // 1. Rename model declaration
    content = content.replace(regex, 'model ' + newName + ' {');
    
    // 2. Add @@map mapping it back to lowercase table name
    // Using a simple replace trick instead of complex regex
    // We replace the last closing brace of the model block with @@map("oldName") }
    // Actually, safer to match 'model NewName {' and find its matching closing brace
    
    const blockStart = content.indexOf(`model ${newName} {`);
    if (blockStart !== -1) {
        let blockEnd = content.indexOf('}', blockStart);
        // Insert @@map just before the closing brace
        content = content.substring(0, blockEnd) + `\n  @@map("${oldName}")\n` + content.substring(blockEnd);
    }

    // 3. Fix relations/type references
    // E.g., 'type inventoryitem' -> 'type InventoryItem'
    // This looks for word boundary, space, the old name, and array brackets or question mark
    const relationRegex = new RegExp('([a-zA-Z0-9_]+\\s+)' + oldName + '(\\?|\\[\\])?', 'g');
    content = content.replace(relationRegex, '$1' + newName + '$2');
  }
}

fs.writeFileSync('prisma/schema.prisma', content);
console.log('Refactored model names successfully!');
