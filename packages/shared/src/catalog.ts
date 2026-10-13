import type { Department, Service, SubTeam } from "./types";

export const MINISTRIES = [
  "Administration",
  "Children’s Ministry",
  "Communications",
  "Community Outreach",
  "Creative Arts",
  "Discipleship",
  "Evangelism",
  "Facilities",
  "Family Ministry",
  "Finance",
  "Hospitality",
  "Men’s Ministry",
  "Missions",
  "Pastoral Care",
  "Prayer Ministry",
  "Production",
  "Sunday Services",
  "Women’s Ministry",
  "Worship",
  "Youth Ministry",
].sort((a, b) => a.localeCompare(b));

export const DEPARTMENTS: {
  id: Department;
  name: string;
  groups: SubTeam[];
}[] = [
  { id: "cell-0", name: "Cell 0", groups: ["Cell 0"] },
  {
    id: "design",
    name: "Design",
    groups: ["Graphic Design", "Art Production"],
  },
  { id: "sound", name: "Sound", groups: ["Sound"] },
  {
    id: "visual-media",
    name: "Visual Media",
    groups: ["Photography", "Video"],
  },
];

export const SERVICES: Service[] = (
  [
    {
      id: "banners",
      name: "Banners",
      department: "design",
      subTeam: "Art Production",
    },
    {
      id: "books-booklets",
      name: "Books and booklets",
      department: "design",
      subTeam: "Art Production",
    },
    {
      id: "decor",
      name: "Décor",
      department: "design",
      subTeam: "Art Production",
    },
    {
      id: "education-support",
      name: "Education support",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "email-design",
      name: "Email design",
      department: "design",
      subTeam: "Graphic Design",
    },
    {
      id: "event-photography",
      name: "Event photography",
      department: "visual-media",
      subTeam: "Photography",
    },
    {
      id: "event-video",
      name: "Event video coverage",
      department: "visual-media",
      subTeam: "Video",
    },
    {
      id: "flyers",
      name: "Flyers",
      department: "design",
      subTeam: "Graphic Design",
    },
    {
      id: "graphic-design",
      name: "Graphic design",
      department: "design",
      subTeam: "Graphic Design",
    },
    {
      id: "live-sound",
      name: "Live sound support",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "motion-graphics",
      name: "Motion graphics",
      department: "design",
      subTeam: "Graphic Design",
    },
    {
      id: "print-production",
      name: "Print production",
      department: "design",
      subTeam: "Art Production",
    },
    {
      id: "set-design",
      name: "Set design",
      department: "design",
      subTeam: "Art Production",
    },
    {
      id: "sermon-recording",
      name: "Sermon recording",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "social-content",
      name: "Social media content",
      department: "visual-media",
      subTeam: "Video",
    },
    {
      id: "sound-editing",
      name: "Sound editing",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "sound-equipment-support",
      name: "Sound and equipment support",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "streaming",
      name: "Livestream production",
      department: "sound",
      subTeam: "Sound",
    },
    {
      id: "video-creation",
      name: "Video creation",
      department: "visual-media",
      subTeam: "Video",
    },
    {
      id: "video-editing",
      name: "Video editing",
      department: "visual-media",
      subTeam: "Video",
    },
    {
      id: "websites",
      name: "Websites",
      department: "design",
      subTeam: "Graphic Design",
    },
    {
      id: "previously-aired-video",
      name: "Retrieve previously aired video",
      department: "visual-media",
      subTeam: "Video",
      requiresAiredDates: true,
    },
  ] satisfies Service[]
).sort((a, b) => a.name.localeCompare(b.name));

export const isDepartment = (value: unknown): value is Department =>
  typeof value === "string" &&
  DEPARTMENTS.some((department) => department.id === value);

export const getService = (id: string): Service | undefined =>
  SERVICES.find((service) => service.id === id);
