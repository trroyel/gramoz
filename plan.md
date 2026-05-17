tep 2: Backend API Development (Choose one to start)
We need to create the NestJS Modules (Controllers, Services, DTOs) to interact with our new tables.

A. Categories & Products Refactor: Create the Category CRUD APIs and ensure the Product API correctly links to Categories.
B. Shopping Cart & Orders Flow: Build the endpoints to add items to a cart, and the complex transaction to convert a Cart into a confirmed Order (and create the initial Order Items).
C. Role-Based Auth: Update your authentication module to handle the new roles (super_admin, admin, support, customer) and set up NestJS Guards to protect routes.
D. Inventory Management: Build the ERP side of things—endpoints to log inventory transactions (stock in/out) rather than just updating a number.