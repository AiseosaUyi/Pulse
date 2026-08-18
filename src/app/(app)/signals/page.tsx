import { redirect } from "next/navigation";

// The nav item is labeled "Competitor intel" now, but "Signals" was the
// label for a long time and is still the more guessable URL for anyone
// used to the old naming — a guessed /signals URL used to 404.
export default function SignalsRedirect() {
  redirect("/intel-feed");
}
