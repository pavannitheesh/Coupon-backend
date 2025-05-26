const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const adminRoutes = require('./routes/adminRoutes');
const couponRoutes = require('./routes/couponRoutes');
const { initializeDatabase } = require('./utils/dbInit');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Initialize database
initializeDatabase().catch(console.error);

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api', couponRoutes);

app.listen(PORT, () => {
  //console.log(`Server is running on port ${PORT}`);
});

module.exports = app;