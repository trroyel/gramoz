export const verificationEmailTemplate = (fullName: string, code: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Welcome to Gramoz, ${fullName}!</h2>
  <p>Thank you for registering. Please verify your email address using the code below:</p>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
    ${code}
  </div>
  <p>This code will expire in 4 hours.</p>
  <p>If you didn't create an account, please ignore this email.</p>
  <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
  <p style="color: #666; font-size: 12px;">Gramoz - E-Commerce Platform for Rural Entrepreneurs</p>
</div>
`;
