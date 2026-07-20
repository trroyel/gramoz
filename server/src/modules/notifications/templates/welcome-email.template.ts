export const welcomeEmailTemplate = (fullName: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Welcome to Gramoz, ${fullName}! 🎉</h2>
  <p>Your email has been verified successfully.</p>
  <p>You can now access all features of Gramoz platform:</p>
  <ul>
    <li>Manage your products</li>
    <li>Track orders and inventory</li>
    <li>Connect with customers</li>
    <li>Grow your rural business</li>
  </ul>
  <p>Get started by logging in to your account.</p>
  <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
  <p style="color: #666; font-size: 12px;">Gramoz - E-Commerce Platform for Rural Entrepreneurs</p>
</div>
`;
