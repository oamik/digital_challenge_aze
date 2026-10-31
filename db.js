const { Pool } = require('pg');

// Lokal PostgreSQL məlumatları
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'team_24q',
    password: process.env.DB_PASSWORD || 'root', // PostgreSQL quraşdırarkən təyin etdiyiniz şifrə
    port: process.env.DB_PORT || 5432,
});

// Bağlantının uğurlu olmasını yoxlamaq
pool.connect((err, client, release) => {
    if (err) {
        return console.error('PostgreSQL bağlantı xətası:', err.stack);
    }
    console.log('✅ Lokal PostgreSQL (team_24q) bazasına uğurla qoşuldu!');
    release();
});

module.exports = pool;