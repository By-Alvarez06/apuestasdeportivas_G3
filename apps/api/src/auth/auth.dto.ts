import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  @MaxLength(254)
  email!: string;
}

export class LoginDto extends EmailDto {
  // La política de longitud se valida en PasswordService para dar un mensaje claro.
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Falta la verificación anti-bots.' })
  @MaxLength(2048)
  captchaToken!: string;
}

export class RegisterDto extends LoginDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.',
  })
  birthDate!: string;
}

export class TokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
