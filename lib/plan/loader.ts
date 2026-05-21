import { prisma } from "@/lib/prisma";

export async function loadDestination(destinationId: string) {
  const dest = await prisma.destination.findUnique({ where: { id: destinationId } });
  if (!dest) return null;

  const destDistrict = await prisma.district.findFirst({
    where: { name: { equals: dest.district, mode: "insensitive" } },
    include: { province: true },
  });

  return {
    id: dest.id,
    name: dest.name,
    latitude: dest.latitude,
    longitude: dest.longitude,
    altitude: dest.altitude ?? null,
    district: destDistrict ?? {
      id: "",
      name: dest.district,
      provinceId: "",
      province: { id: "", name: dest.province },
    },
  };
}

export async function loadLeaderData(userId: string) {
  const [health, user] = await Promise.all([
    prisma.userHealth.findUnique({
      where: { userId },
      select: { fitnessLevel: true, mobilityLimited: true, chronicConditions: true, allergies: true, bloodType: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        homeLocation: { include: { district: { include: { province: true } } } },
        preference: true,
      },
    }),
  ]);

  const profileNotif = await prisma.notification.findFirst({
    where: { userId, message: { contains: '"_type":"PROFILE"' } },
  });
  const profile = profileNotif ? JSON.parse(profileNotif.message) : null;
  const travelPurposes = (profile?.travelPurposes ?? []) as string[];

  return { health, user, travelPurposes, profile };
}

export async function loadGroupMembers(memberUsernames: string[]) {
  const users = await prisma.user.findMany({
    where: { username: { in: memberUsernames.map((u) => u.replace(/^@/, "")) } },
    include: {
      health: true,
      homeLocation: { include: { district: { include: { province: true } } } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name ?? u.username ?? "Unknown",
    username: u.username,
    health: u.health,
    homeAltitude: u.homeLocation?.altitude ?? 0,
    homeProvince: u.homeLocation?.district?.province?.name ?? "",
  }));
}
