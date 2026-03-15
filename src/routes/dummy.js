const axios = require('axios');
const bcrypt = require('bcrypt');

const userData = {
  name: "Kalyan Kumar Karn",
  email: "karnkalyan@gmail.com",
  role: 1,
  status: "active",
  department: "IT",
  passwordHash: "kalyan", // plain text initially
  ispId: 1
};

const postUser = async () => {
  try {
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(userData.passwordHash, saltRounds);

    // Replace plain password with hashed version
    userData.passwordHash = hashedPassword;

    // POST the data
    const response = await axios.post('http://localhost:3200/api/users', userData);

    console.log('✅ Data posted successfully:', response.data);
  } catch (error) {
    console.error('❌ Error posting data:', error.message);
  }
};

postUser();
