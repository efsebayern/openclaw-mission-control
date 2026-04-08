import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SignedOutPanel } from "./SignedOutPanel";

const isLocalAuthModeMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth/localAuth", () => ({
  isLocalAuthMode: isLocalAuthModeMock,
}));

vi.mock("@/components/organisms/LocalAuthLogin", () => ({
  LocalAuthLogin: () => <div>Local Auth Login</div>,
}));

vi.mock("@/auth/clerk", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("SignedOutPanel", () => {
  afterEach(() => {
    isLocalAuthModeMock.mockReset();
  });

  it("renders local auth login in local auth mode", () => {
    isLocalAuthModeMock.mockReturnValue(true);

    render(
      <SignedOutPanel
        message="Sign in to continue."
        forceRedirectUrl="/onboarding"
      />,
    );

    expect(screen.getByText("Local Auth Login")).toBeInTheDocument();
    expect(screen.queryByText("Sign in to continue.")).not.toBeInTheDocument();
  });

  it("renders the sign-in panel outside local auth mode", () => {
    isLocalAuthModeMock.mockReturnValue(false);

    render(
      <SignedOutPanel
        message="Sign in to continue."
        forceRedirectUrl="/onboarding"
      />,
    );

    expect(screen.getByText("Sign in to continue.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});
