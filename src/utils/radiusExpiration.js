function formatRadiusExpiration(date) {
  const expirationDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(expirationDate.getTime())) throw new Error('Invalid RADIUS expiration date');

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = value => String(value).padStart(2, '0');
  return `${pad(expirationDate.getDate())} ${months[expirationDate.getMonth()]} ${expirationDate.getFullYear()} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;
}

module.exports = { formatRadiusExpiration };
