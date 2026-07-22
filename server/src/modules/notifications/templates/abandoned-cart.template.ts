export const abandonedCartTemplate = (
  fullName: string,
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: string;
  }>,
  frontendUrl: string,
) => {
  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${item.productName} (x${item.quantity})</td>
      <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: right;">$${item.unitPrice}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #22c55e; padding: 20px; text-align: center;">
        <h2 style="color: #fff; margin: 0;">You left something behind!</h2>
      </div>
      <div style="padding: 20px;">
        <p>Hi ${fullName},</p>
        <p>We noticed you left some amazing items in your cart. Don't worry, we've saved them for you!</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          ${itemsHtml}
        </table>
        
        <div style="text-align: center; margin-top: 30px;">
          <a href="${frontendUrl}/cart" style="background-color: #22c55e; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Return to Cart</a>
        </div>
        
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          If you have any questions, our support team is always here to help.
        </p>
      </div>
    </div>
  `;
};
