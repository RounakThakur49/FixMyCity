const getFormattedDate = () => {
  try {
    const opts = {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    };
    return new Intl.DateTimeFormat('en-CA', opts).format(new Date()).replace(',', '');
  } catch (e) {
    return new Date().toISOString().replace('T', ' ').substring(0, 16);
  }
};
module.exports = { getFormattedDate };
