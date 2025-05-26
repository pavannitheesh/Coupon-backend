const pool = require('../config/database');

const claimCoupon = async (req, res) => {
  try {
    const ip = req.ip;
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const availableCoupons = await client.query(
        'SELECT * FROM coupons WHERE is_active = TRUE AND is_claimed = FALSE ORDER BY id ASC LIMIT 1'
      );
      
      if (availableCoupons.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No coupons available at this time' });
      }
      
      const coupon = availableCoupons.rows[0];
      await client.query('UPDATE coupons SET is_claimed = TRUE WHERE id = $1', [coupon.id]);
      await client.query('INSERT INTO claims (coupon_id, ip_address) VALUES ($1, $2)', [coupon.id, ip]);
      await client.query('COMMIT');
      
      res.cookie('claimed', 'true', { httpOnly: true, maxAge: 60000, sameSite: 'none' });
      res.status(200).json({
        message: 'Coupon claimed successfully',
        coupon: {
          code: coupon.code,
          discount_amount: coupon.discount_amount,
          description: coupon.description
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error claiming coupon:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  claimCoupon
};