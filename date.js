const dayjs = require('dayjs');

console.log(dayjs().add(1, 'day').format("YYYY-MM-DD HH:mm:ss"));
console.log(dayjs().add(5, 'hours').format("YYYY-MM-DD HH:mm:ss"));
console.log(dayjs().add(6, 'months').format("YYYY-MM-DD HH:mm:ss"));
console.log(dayjs().add(1, 'year').format("YYYY-MM-DD HH:mm A"));
