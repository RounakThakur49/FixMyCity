// Mask Aadhar: show only last 4 digits
function maskAadhar(aadhar) {
  if (!aadhar || aadhar.length < 4) return 'XXXX XXXX XXXX';
  return `XXXX XXXX ${aadhar.slice(-4)}`;
}
module.exports = { maskAadhar };
