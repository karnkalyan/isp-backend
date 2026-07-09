function formatRadiusExpiration(date) {
  const expirationDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(expirationDate.getTime())) throw new Error('Invalid RADIUS expiration date');

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(expirationDate);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('day')} ${value('month')} ${value('year')} 23:59:59`;
}

module.exports = { formatRadiusExpiration };
