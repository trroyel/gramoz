export const passwordResetTemplate = (fullName: string, code: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Password Reset Request</h2>
  <p>Hi ${fullName},</p>
  <p>We received a request to reset your password. Use the code below to reset it:</p>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
    ${code}
  </div>
  <p>This code will expire in 1 hour.</p>
  <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
  <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
  <p style="color: #666; font-size: 12px;">Gramoz - E-Commerce Platform for Rural Entrepreneurs</p>
</div>
`;
