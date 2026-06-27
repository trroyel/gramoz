const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgres://platform_user:platform_pass@localhost:5433/platform_db' });
  await client.connect();
  const res = await client.query("SELECT user_id, email FROM orders JOIN users ON orders.user_id = users.id WHERE orders.id = 'a22ef55c-2180-4876-8efa-432b8fb8153c'");
  console.log(res.rows);
  await client.end();
}
run();
