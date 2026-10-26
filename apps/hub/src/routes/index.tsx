import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home(): React.JSX.Element {
  return <main><h1>xpro</h1></main>;
}
