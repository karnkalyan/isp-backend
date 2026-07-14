// src/prisma/client.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const aliases = {
  Branch: 'branch',
  BranchSetting: 'branchSetting',
  ConnectionType: 'connectionType',
  ConnectionUser: 'connectionUser',
  CustomerDevice: 'customerDevice',
  customerDevice: 'customerDevice',
  CustomerDocument: 'customerDocument',
  customerDocument: 'customerDocument',
  CustomerOrderManagement: 'customerOrderManagement',
  customerOrderManagement: 'customerOrderManagement',
  CustomerServiceConnection: 'customerServiceConnection',
  customerServiceConnection: 'customerServiceConnection',
  CustomerSubscribedService: 'customerSubscribedService',
  customerSubscribedService: 'customerSubscribedService',
  CustomerSubscription: 'customerSubscription',
  customerSubscription: 'customerSubscription',
  Department: 'department',
  ISPSettings: 'iSPSettings',
  InventoryItem: 'inventoryItem',
  InventoryLog: 'inventoryLog',
  Lead: 'lead',
  MapFile: 'mapFile',
  MapFolder: 'mapFolder',
  OLT: 'oLT',
  ONT: 'oNT',
  ONTDetails: 'oNTDetails',
  OLTProfile: 'oLTProfile',
  OLTVLAN: 'oLTVLAN',
  PackagePlan: 'packagePlan',
  PackagePrice: 'packagePrice',
  PackagePlanBranch: 'packagePlanBranch',
  PackageOneTimeCharges: 'packageOneTimeCharge',
  packageOneTimeCharges: 'packageOneTimeCharge',
  packageonetimecharges: 'packageOneTimeCharge',
  OneTimeCharge: 'oneTimeCharge',
  ServiceBoard: 'serviceBoard',
  ServiceBoardPort: 'serviceBoardPort',
  ServiceCredential: 'serviceCredential',
  Splitter: 'splitter',
  splitter: 'splitter',
  TR069Device: 'tr069Device',
  Ticket: 'ticket',
  Vendor: 'vendor',
  vendor: 'vendor'
};

for (const [alias, delegate] of Object.entries(aliases)) {
  if (!prisma[alias] && prisma[delegate]) {
    prisma[alias] = prisma[delegate];
  }
}

module.exports = prisma;
