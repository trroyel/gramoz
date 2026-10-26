import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { OrdersStore } from './orders.store';
import { FastifyReply } from 'fastify';

@Injectable()
export class InvoicesService {
  constructor(private readonly ordersStore: OrdersStore) {}

  async generateInvoicePdf(orderId: string, res: FastifyReply): Promise<void> {
    const orderDetails = await this.ordersStore.getOrderDetailsAsAdmin(orderId);
    if (!orderDetails) {
      throw new NotFoundException('Order not found');
    }

    const items = await this.ordersStore.getOrderItemsWithProducts(orderId);
    const order = { ...orderDetails, items };

    const doc = new PDFDocument({ margin: 50 });

    // Set headers for PDF download
    res.header('Content-Type', 'application/pdf');
    res.header(
      'Content-Disposition',
      `attachment; filename="Invoice-${order.id.slice(0, 8).toUpperCase()}.pdf"`,
    );

    // Pipe the PDF document to the Fastify response
    doc.pipe(res.raw);

    this.generateHeader(doc);
    this.generateCustomerInformation(doc, order);
    this.generateInvoiceTable(doc, order);
    this.generateFooter(doc);

    doc.end();
  }

  private generateHeader(doc: typeof PDFDocument) {
    doc
      .fillColor('#22c55e')
      .fontSize(24)
      .text('GRAMOZ', 50, 45)
      .fillColor('#444444')
      .fontSize(10)
      .text('Gramoz Inc.', 200, 50, { align: 'right' })
      .text('123 eCommerce Street', 200, 65, { align: 'right' })
      .text('Dhaka, Bangladesh, 1212', 200, 80, { align: 'right' })
      .moveDown();
  }

  private generateCustomerInformation(doc: typeof PDFDocument, order: any) {
    doc.fillColor('#444444').fontSize(20).text('INVOICE', 50, 120);

    this.generateHr(doc, 150);

    const customerInformationTop = 165;

    // We expect order.user to have fullName, but in getOrderById it might just be the raw order
    // Note: If ordersStore doesn't fetch user info, we'll just use the user ID or a placeholder.
    // The current order type from the DB doesn't join user in getOrderById unless we write a specific query.
    // We will just use the shipping address if available.

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Order ID:', 50, customerInformationTop)
      .font('Helvetica')
      .text(order.id, 150, customerInformationTop)
      .font('Helvetica-Bold')
      .text('Order Date:', 50, customerInformationTop + 15)
      .font('Helvetica')
      .text(
        new Date(order.createdAt).toLocaleDateString(),
        150,
        customerInformationTop + 15,
      )
      .font('Helvetica-Bold')
      .text('Status:', 50, customerInformationTop + 30)
      .font('Helvetica')
      .text(order.status.toUpperCase(), 150, customerInformationTop + 30);

    this.generateHr(doc, 220);
  }

  private generateInvoiceTable(doc: typeof PDFDocument, order: any) {
    const invoiceTableTop = 250;

    doc.font('Helvetica-Bold');
    this.generateTableRow(
      doc,
      invoiceTableTop,
      'Item',
      'Unit Price',
      'Quantity',
      'Total',
    );
    this.generateHr(doc, invoiceTableTop + 20);
    doc.font('Helvetica');

    let position = invoiceTableTop + 30;

    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        this.generateTableRow(
          doc,
          position,
          item.productName || 'Product',
          `BDT ${parseFloat(item.unitPrice).toFixed(2)}`,
          item.quantity.toString(),
          `BDT ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}`,
        );
        position += 20;
      }
    } else {
      doc.text('No items found in this order.', 50, position);
      position += 20;
    }

    this.generateHr(doc, position + 10);

    const subtotalPosition = position + 20;
    doc.font('Helvetica-Bold');
    this.generateTableRow(
      doc,
      subtotalPosition,
      '',
      '',
      'Total Amount:',
      `BDT ${parseFloat(order.totalAmount).toFixed(2)}`,
    );
  }

  private generateFooter(doc: typeof PDFDocument) {
    doc.fontSize(10).text('Thank you for shopping with Gramoz!', 50, 700, {
      align: 'center',
      width: 500,
    });
  }

  private generateTableRow(
    doc: typeof PDFDocument,
    y: number,
    item: string,
    unitCost: string,
    quantity: string,
    lineTotal: string,
  ) {
    doc
      .fontSize(10)
      .text(item, 50, y, { width: 250 })
      .text(unitCost, 300, y, { width: 90, align: 'right' })
      .text(quantity, 400, y, { width: 90, align: 'right' })
      .text(lineTotal, 0, y, { align: 'right' });
  }

  private generateHr(doc: typeof PDFDocument, y: number) {
    doc
      .strokeColor('#aaaaaa')
      .lineWidth(1)
      .moveTo(50, y)
      .lineTo(550, y)
      .stroke();
  }
}
