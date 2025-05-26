const express = require('express');
const claimLimiter = require('../middleware/rateLimiter');
const couponController = require('../controllers/couponController');

const router = express.Router();

router.post('/claim-coupon', claimLimiter, couponController.claimCoupon);

module.exports = router;