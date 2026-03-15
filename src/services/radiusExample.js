const { RadiusClient } = require('../services/radiusClient.js');

async function demo() {
  // RadiusClient.create को async function के अंदर await करो
  const radius = await RadiusClient.create(1); // ISP ID = 1

  // radcheck list
  const radUser = await radius.radcheck.list();
  console.log('radcheck list:', radUser);

  // Example: create radcheck user
  // const newReply = await radius.radcheck.create({
  //   username: 'newAPI',
  //   attribute: 'Cleartext-Password',
  //   op: ':=',
  //   value: 'newAPI123',
  // });
  // console.log('radcheck created:', newReply);

  // const radUserag = await radius.radcheck.list();
  // console.log('radcheck list again:', radUserag);
}

demo().catch(console.error);
