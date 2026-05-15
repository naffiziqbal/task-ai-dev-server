import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { AuthService, type PublicUser } from "./auth.service";

export const SESSION_COOKIE = "session";

class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: "password must be at least 8 characters" })
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  async signUp(
    @Body() body: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const { user, token, expiresAt } = await this.auth.signUp(body);
    setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Body() body: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const { user, token, expiresAt } = await this.auth.signIn(
      body.email,
      body.password,
    );
    setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readSessionCookie(req);
    if (token) await this.auth.signOut(token);
    clearSessionCookie(res);
  }

  @Get("me")
  async me(@Req() req: Request): Promise<{ user: PublicUser }> {
    const token = readSessionCookie(req);
    const user = token ? await this.auth.getUserByToken(token) : null;
    if (!user) throw new UnauthorizedException();
    return { user };
  }
}

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    expires: expiresAt,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    path: "/",
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}
