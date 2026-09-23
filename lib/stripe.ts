import Stripe from "stripe";
import { env } from "@/lib/env";

export function getStripeClient(): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY);
}
