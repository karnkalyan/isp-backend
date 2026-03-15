// example.js
const { TshulClient } = require('./tshulApi');

async function main() {
  try {
    // Replace with your ISP ID from the database
    const ispId = 1;

    // Create a Tshul client instance
    const tshul = await TshulClient.create(ispId);

    // --- Fetch Customers ---
    const customers = await tshul.customer.list();
    if (customers.Error) {
      console.error('Error fetching customers:', customers.Error);
    } else {
      console.log('Customers:', customers);
    }

    // --- Fetch Branches ---
    const branches = await tshul.branch.list();
    if (branches.Error) {
      console.error('Error fetching branches:', branches.Error);
    } else {
      console.log('Branches:', branches);
    }

    // --- Fetch Items ---
    const items = await tshul.item.list();
    if (items.Error) {
      console.error('Error fetching items:', items.Error);
    } else {
      console.log('Items:', items);
    }

  } catch (err) {
    console.error('Unexpected error:', err.message);
  }
}

main();
