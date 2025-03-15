const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin:  'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());



const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD } = process.env;

const pool = new Pool({
  host: PGHOST,
  database: PGDATABASE,
  username: PGUSER,
  password: PGPASSWORD,
  port: 5432,
  ssl: {
    require: true,
  },
});

async function getPgVersion() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT version()');
    console.log(result.rows[0]);
  } finally {
    client.release();
  }
}

getPgVersion();


const claimLimiter = rateLimit({
  windowMs:  60 * 1000, // 24 hours
  max: 1,
  message: { error: 'Too many coupon claims from this IP, please try again after 24 hours' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        is_claimed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS claims (
        id SERIAL PRIMARY KEY,
        coupon_id INT NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (coupon_id) REFERENCES coupons(id)
      );
    `);

    const result = await pool.query('SELECT * FROM admins');
    if (result.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO admins (username, password) VALUES ($1, $2)',
        ['admin', hashedPassword]
      );
      console.log('Default admin created: username=admin, password=admin123');
    }
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initializeDatabase().catch(console.error);

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, admin.password);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, username: admin.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, { httpOnly: true, maxAge: 86400000, sameSite: 'strict' });
    res.json({ message: 'Login successful', admin: { id: admin.id, username: admin.username } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
// 2. Admin logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout successful' });
});
app.get('/api/admin/coupons', authenticate, async (req, res) => {
  try {
    // Fetch available (unclaimed) coupons
    const availableCouponsQuery = `
      SELECT * FROM coupons 
      WHERE is_active = TRUE AND is_claimed = FALSE
      ORDER BY created_at DESC
    `;
    const availableCouponsResult = await pool.query(availableCouponsQuery);
console.log(availableCouponsResult.rows)  
    // Fetch claimed coupons with claim details
    const claimedCouponsQuery = `
            SELECT c.*, cl.ip_address, cl.claimed_at
      FROM coupons c
      JOIN claims cl ON c.id = cl.coupon_id
      WHERE c.is_claimed = TRUE;
    `;
    const claimedCouponsResult = await pool.query(claimedCouponsQuery);
console.log(claimedCouponsResult.rows);
    res.json({
      available_coupons: availableCouponsResult.rows,
      claimed_coupons: claimedCouponsResult.rows
    });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
// 4. Add new coupon (admin only)
app.post('/api/admin/add-coupon', 
  authenticate,
  body('code').isString().trim().notEmpty(),
  body('discount_amount').isNumeric(),
  body('description').isString().optional(),
  body('is_active').isBoolean(),
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { code, discount_amount, description, is_active } = req.body;
    
    try {
     
      const existingCoupon = await pool.query(
        'SELECT id FROM coupons WHERE code = $1 LIMIT 1',
        [code]
      );

      if (existingCoupon.rows.length > 0) {
        return res.status(400).json({ error: 'Coupon code already exists. Please use a unique code.' });
      }

      // Insert new coupon
      await pool.query(
        'INSERT INTO coupons (code, discount_amount, description, is_active) VALUES ($1, $2, $3, $4)',
        [code, discount_amount, description, is_active]
      );
      
      res.status(201).json({ 
        message: 'Coupon created successfully'
      });
    } catch (error) {
      console.error('Error creating coupon:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);
app.put('/api/admin/coupons/:id', 
  authenticate,
  body('code').optional().isString().trim().notEmpty(),
  body('discount_amount').optional().isNumeric(),
  body('description').optional().isString(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { code, discount_amount, description, is_active } = req.body;

    try {
      // Check if coupon exists
      const checkQuery = 'SELECT * FROM coupons WHERE id = $1';
      const checkResult = await pool.query(checkQuery, [id]);

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Coupon not found' });
      }

      // Prepare update query dynamically
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

      // Execute the update query
      const updateQuery = `
        UPDATE coupons 
        SET ${updateFields.join(', ')}, updated_at = NOW() 
        WHERE id = $${updateValues.length}
      `;
      await pool.query(updateQuery, updateValues);

      res.json({ message: 'Coupon updated successfully' });

    } catch (error) {
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ error: 'Coupon code already exists' });
      }
      console.error('Error updating coupon:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

const checkSessionCookie = (req, res, next) => {
  if (req.cookies.claimed) {
      return res.status(401).json({ message: "You've already claimed a coupon in this session." });
  }
  next();
};
app.post('/api/claim-coupon',checkSessionCookie, claimLimiter, async (req, res) => {
  try {
   
    const ip = req.ip;
    console.log("Ip address:"+ip)
    // const result = await pool.query(
    //   `SELECT * FROM claims WHERE ip_address = $1 AND claimed_at > NOW() - INTERVAL '24 hours'`,
    //   [ip]
    // );
    // if (result.rows.length > 0) {
    //   return res.status(401).json({ error: 'You have already claimed a coupon recently. Please try again later.' });
    // }
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
      res.cookie('claimed', 'true', { httpOnly: true,maxAge: 60000, sameSite: 'strict' });
      res.status(200).json({ message: 'Coupon claimed successfully', coupon: { code: coupon.code, discount_amount: coupon.discount_amount, description: coupon.description } });
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
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
