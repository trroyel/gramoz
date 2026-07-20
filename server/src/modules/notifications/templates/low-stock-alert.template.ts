export const lowStockAlertTemplate = (
  products: Array<{ name: string; stock: number; threshold: number }>,
  adminDashboardUrl: string,
) => {
  const rows = products
    .map(
      (p) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #fee2e2; color: #1f2937; font-size:14px;">
          ${p.name}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #fee2e2; text-align:center;">
          <span style="background:#fef2f2; color:#dc2626; font-weight:700; padding:3px 10px; border-radius:12px; font-size:13px;">
            ${p.stock} left
          </span>
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #fee2e2; text-align:center; color:#9ca3af; font-size:13px;">
          Threshold: ${p.threshold}
        </td>
      </tr>`,
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#fef2f2; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#dc2626; padding:28px 40px; text-align:center;">
              <p style="margin:0; font-size:28px;">⚠️</p>
              <h1 style="margin:8px 0 0; color:#fff; font-size:20px; font-weight:700;">
                Low Stock Alert
              </h1>
              <p style="margin:6px 0 0; color:rgba(255,255,255,0.85); font-size:13px;">
                ${products.length} product${products.length > 1 ? 's are' : ' is'} running low
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 24px; color:#374151; font-size:15px; line-height:1.6;">
                The following products have fallen below their minimum stock threshold.
                Please restock soon to avoid losing sales.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <thead>
                  <tr style="background:#fef2f2;">
                    <th style="text-align:left; padding:10px 12px; color:#6b7280; font-size:12px; text-transform:uppercase; font-weight:600;">Product</th>
                    <th style="text-align:center; padding:10px 12px; color:#6b7280; font-size:12px; text-transform:uppercase; font-weight:600;">Current Stock</th>
                    <th style="text-align:center; padding:10px 12px; color:#6b7280; font-size:12px; text-transform:uppercase; font-weight:600;">Minimum</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>

              <div style="text-align:center; margin-top:32px;">
                <a href="${adminDashboardUrl}/products"
                   style="display:inline-block; background:#dc2626; color:#fff; text-decoration:none;
                          padding:13px 28px; border-radius:6px; font-size:14px; font-weight:600;">
                  Manage Products
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Gramoz Admin — Low Stock Notification
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
