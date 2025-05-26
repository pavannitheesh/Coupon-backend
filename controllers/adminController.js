const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const pool = require('../config/database');

const login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, admin.password);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, username: admin.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, { httpOnly: true, maxAge: 60000, sameSite: 'none' });
    res.json({ message: 'Login successful', admin: { id: admin.id, username: admin.username } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const logout = (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout successful' });
};

const getCoupons = async (req, res) => {
  try {
    const availableCouponsQuery = `
      SELECT * FROM coupons 
      WHERE is_active = TRUE AND is_claimed = FALSE
      ORDER BY created_at DESC
    `;
    const availableCouponsResult = await pool.query(availableCouponsQuery);

    const claimedCouponsQuery = `
      SELECT c.*, cl.ip_address, cl.claimed_at
      FROM coupons c
      JOIN claims cl ON c.id = cl.coupon_id
      WHERE c.is_claimed = TRUE;
    `;
    const claimedCouponsResult = await pool.query(claimedCouponsQuery);

    res.json({
      available_coupons: availableCouponsResult.rows,
      claimed_coupons: claimedCouponsResult.rows
    });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const addCoupon = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { code, discount_amount, description, isActive: is_active } = req.body;

  try {
    const existingCoupon = await pool.query(
      'SELECT id FROM coupons WHERE code = $1 LIMIT 1',
      [code]
    );

    if (existingCoupon.rows.length > 0) {
      return res.status(400).json({ error: 'Coupon code already exists. Please use a unique code.' });
    }

    await pool.query(
      'INSERT INTO coupons (code, discount_amount, description, is_active) VALUES ($1, $2, $3, $4)',
      [code, discount_amount, description, is_active]
    );

    res.status(201).json({ message: 'Coupon created successfully' });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateCoupon = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { code, discount_amount, description, isActive: is_active } = req.body;

  try {
    const checkResult = await pool.query('SELECT * FROM coupons WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    const updateFields = [];
    const updateValues = [];

    if (code) {
      updateFields.push('code = $' + (updateValues.length + 1));
      updateValues.push(code);
    }
    if (discount_amount) {
      updateFields.push('discount_amount = $' + (updateValues.length + 1));
      updateValues.push(discount_amount);
    }
    if (description) {
      updateFields.push('description = $' + (updateValues.length + 1));
      updateValues.push(description);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = $' + (updateValues.length + 1));
      updateValues.push(is_active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(id);

    const updateQuery = `
      UPDATE coupons 
      SET ${updateFields.join(', ')}, updated_at = NOW() 
      WHERE id = $${updateValues.length}
    `;
    await pool.query(updateQuery, updateValues);

    res.json({ message: 'Coupon updated successfully' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Coupon code already exists' });
    }
    console.error('Error updating coupon:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  login,
  logout,
  getCoupons,
  addCoupon,
  updateCoupon
};