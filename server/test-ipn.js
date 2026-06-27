const crypto = require('crypto');
function md5(input) { return crypto.createHash('md5').update(input).digest('hex'); }
console.log(md5('gramo6a09a6a42ff2d@ssl'));
console.log(md5('testpass'));
