interface OrderItem {
  productName: string | null;
  quantity: number;
  unitPrice: string;
}

export const orderConfirmationTemplate = (
  fullName: string,
  orderId: string,
  items: OrderItem[],
  totalAmount: string,
  frontendUrl: string,
) => {
  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #333;">
          ${item.productName ?? 'Product'}
        </td>
        <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: center; color: #555;">
          ${item.quantity}
        </td>
        <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; color: #333; font-weight: 600;">
          ৳${parseFloat(item.unitPrice).toFixed(2)}
        </td>
      </tr>`,
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #10b981, #059669); padding: 32px 40px; text-align: center;">
              <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">✓ Order Confirmed</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size:14px;">Thank you for shopping with Gramoz</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">

              <p style="margin: 0 0 8px; color: #333; font-size:16px;">Hi <strong>${fullName}</strong>,</p>
              <p style="margin: 0 0 28px; color: #555; font-size:15px; line-height:1.6;">
                Your order has been placed successfully. We'll notify you once it ships.
              </p>

              <!-- Order ID badge -->
              <div style="background:#f0fdf4; border: 1px solid #bbf7d0; border-radius:6px; padding:16px 20px; margin-bottom:28px;">
                <p style="margin:0; color:#166534; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Order ID</p>
                <p style="margin:4px 0 0; color:#15803d; font-size:15px; font-weight:700; font-family:monospace;">${orderId}</p>
              </div>

              <!-- Items table -->
              <h3 style="margin: 0 0 16px; color: #111; font-size:15px; font-weight:700; border-bottom: 2px solid #f0f0f0; padding-bottom:12px;">
                Items Ordered
              </h3>
              <table width="100%" cellpadding="0" cellspacing="0">
                <thead>
                  <tr>
                    <th style="text-align:left; padding-bottom:8px; color:#888; font-size:12px; text-transform:uppercase; font-weight:600;">Product</th>
                    <th style="text-align:center; padding-bottom:8px; color:#888; font-size:12px; text-transform:uppercase; font-weight:600;">Qty</th>
                    <th style="text-align:right; padding-bottom:8px; color:#888; font-size:12px; text-transform:uppercase; font-weight:600;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <!-- Total -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td style="color:#111; font-size:16px; font-weight:700; padding-top:16px;">Total</td>
                  <td style="text-align:right; color:#10b981; font-size:20px; font-weight:700; padding-top:16px;">৳${parseFloat(totalAmount).toFixed(2)}</td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="text-align:center; margin-top:36px;">
                <a href="${frontendUrl}/orders"
                   style="display:inline-block; background:#10b981; color:#ffffff; text-decoration:none;
                          padding:14px 32px; border-radius:6px; font-size:15px; font-weight:600;">
                  View My Orders
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; padding:24px 40px; text-align:center; border-top: 1px solid #eee;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">
                Gramoz — E-Commerce Platform for Rural Entrepreneurs
              </p>
              <p style="margin:4px 0 0; color:#d1d5db; font-size:11px;">
                If you didn't place this order, please contact us immediately.
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
