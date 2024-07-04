import prisma from "@/db/prisma"
import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import Stripe from "stripe"

// Stripe //
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

// Resend Email //
const resend = new Resend(process.env.RESEND_API_KEY as string)

// Stripe Webhook //
export async function POST(req: NextRequest) {
  const event = await stripe.webhooks.constructEvent(
    await req.text(),
    req.headers.get("stripe-signature") as string,
    process.env.STRIPE_WEBHOOK_SECRET as string
  )

  if (event.type === "charge.succeeded") {
    const charge = event.data.object
    const productId = charge.metadata.productId
    const email = charge.billing_details.email
    const pricePaidInCents = charge.amount

    const product = await prisma.product.findUnique({
      where: { id: productId },
    })
    if (product == null || email == null) {
      return new NextResponse("Bad Request", { status: 400 })
    }

    // Prisma Update | Create User //
    const userFields = {
      email,
      orders: { create: { productId, pricePaidInCents } },
    }
    const {
      orders: [orders],
    } = await prisma.user.upsert({
      where: { email },
      create: userFields,
      update: userFields,
      select: { orders: { orderBy: { createdAt: "desc" }, take: 1 } },
    })

    const downloadVerification = await prisma.downloadVerification.create({
      data: {
        productId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    })

    // Send Email //
    try {
      const { data, error } = await resend.emails.send({
        from: `Support <${process.env.RESEND_SENDER_EMAIL}>`,
        to: email,
        subject: "Order Confirmation - Test",
        react: <h1>Order Confirmation - Test</h1>,
      })

      if (error) {
        return Response.json({ error }), { status: 500 }
      }

      return Response.json(data)
    } catch (err) {
      return Response.json({ err }), { status: 500 }
    }
  }
  return new NextResponse()
}
