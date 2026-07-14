const { tshul } = require('../services/tshulApi');

async function getTshulCustomers(req, res) {
  try {
    const customers = await tshul.customer.list(); // Now this works
    res.json({ success: true, data: customers });
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customers', error: err.message });
  }
}


async function getTshulBranches(req, res) {
  try {
    const branch = await tshul.branch.list(); // Now this works
    res.json({ success: true, data: branch });
  } catch (err) {
    console.error('Error fetching Branches:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch Branches', error: err.message });
  }
}


module.exports = {
  getTshulCustomers,
  getTshulBranches
};
