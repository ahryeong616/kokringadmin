require('dotenv').config();
const mariadb = require('mariadb');

async function main() {
  const conn = await mariadb.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('\n✅ MariaDB 연결 성공');

  const rows = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('app_settings', 'products', 'purchases', 'costs', 'sales')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  console.table(
    rows.map(({ TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY }) => ({
      TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
    }))
  );

  await conn.end();
}

main().catch((err) => {
  console.error('\n❌ 연결 실패:', err.code || '', err.message);
  process.exit(1);
});
