const rateLimit = require('express-rate-limit');

const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  message: { error: 'Too many coupon claims from this IP, please try again after 24 hours' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

module.exports = claimLimiter;