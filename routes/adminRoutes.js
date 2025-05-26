const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/auth');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.post('/login', adminController.login);
router.post('/logout', adminController.logout);
router.get('/coupons', authenticate, adminController.getCoupons);
router.post('/add-coupon',
  authenticate,
  [
    body('code').isString().trim().notEmpty(),
    body('discount_amount').isNumeric(),
    body('description').isString().optional(),
    body('isActive').isBoolean()
  ],
  adminController.addCoupon
);
router.put('/coupons/:id',
  authenticate,
  [
    body('code').optional().isString().trim().notEmpty(),
    body('discount_amount').optional().isNumeric(),
    body('description').optional().isString(),
    body('isActive').optional().isBoolean()
  ],
  adminController.updateCoupon
);

module.exports = router;