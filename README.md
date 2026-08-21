# StreamBIM UE Onboarding

Publik StreamBIM-widget för att testa onboarding av underentreprenörer stegvis.

Widgeten kan:

- kontrollera namn mot befintliga resurser
- skapa eller återanvända en projektgrupp
- lägga till aktuell användare som gruppadministratör
- skapa eller återanvända en mapp
- sätta gruppens mappbehörighet
- kopiera ett workflow och ge gruppen grundåtkomst
- kopiera en checklista, ge gruppen åtkomst via checklistans workflow och publicera checklistan
- visa, kopiera och ladda ner en teknisk logg

Alla skrivande åtgärder kräver att användaren aktiverar skrivläge och bekräftar varje steg. Åtgärderna körs med den aktuella StreamBIM-användarens behörigheter via `connectToParent` och `makeApiRequest`.

`PATCH` är inte listat bland de dokumenterade metoderna för `makeApiRequest` och testas därför explicit i separata steg.
