const axios = require('axios');
let data = JSON.stringify({
  "customerUniqueId": "CUS-CH-00002SIMUL"
});

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'http://localhost:3200/esewa/initiate',
  headers: { 
    'Content-Type': 'application/json', 
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlc2V3YUNvbmZpZ0lkIjoxLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzY2NjUzNzU4LCJleHAiOjE3NjY2NTQwMDh9.KleHaMiwo8jeJkhtsELkL-old_3g3e-28Votd_gUqyQ'
  },
  data : data
};

axios.request(config)
.then((response) => {
  console.log(JSON.stringify(response.data));
})
.catch((error) => {
  console.log(error);
});
