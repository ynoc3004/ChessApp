import AcademyClient from "./AcademyClient";
import AssignmentQuickLink from "./AssignmentQuickLink";
import PracticalQuickLink from "./PracticalQuickLink";
import TournamentQuickLink from "./TournamentQuickLink";

export default function AcademyPage() {
  return <><AcademyClient /><PracticalQuickLink /><TournamentQuickLink /><AssignmentQuickLink /></>;
}
