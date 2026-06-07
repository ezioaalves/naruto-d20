#!/usr/bin/env perl

# Convert Naruto d20 Markdown class entries into deterministic PF1e class JSON.
# Run with --check before generation to detect source/output drift safely.

use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));
use Digest::SHA qw(sha256_hex);
use Getopt::Long qw(GetOptions);
use JSON::PP;

my $source_dir = "Classes/Prestige";
my $output_dir = "packs/_source/classes";
my $template_path;
my $folder_id = "Ei6uGmYukb9vCaYd";
my $check_only = 0;
my $help = 0;

GetOptions(
  "source-dir=s" => \$source_dir,
  "output-dir=s" => \$output_dir,
  "template=s" => \$template_path,
  "folder-id=s" => \$folder_id,
  "check" => \$check_only,
  "help" => \$help,
) or usage(1);
usage(0) if $help;
$template_path //= "$output_dir/Livewire_ywwhNtzs3fPtKfO5.json";

my %fixed_ids = (
  "Livewire" => "ywwhNtzs3fPtKfO5",
);

my %icons = (
  "Beastlord" => "systems/pf1/icons/feats/animal-affinity.jpg",
  "Beastmaster" => "systems/pf1/icons/races/creature-types/animal.png",
  "Berserker" => "systems/pf1/icons/feats/extra-rage.jpg",
  "Blinkstrike" => "systems/pf1/icons/spells/haste-fire-1.jpg",
  "Commando" => "systems/pf1/icons/feats/leadership.jpg",
  "Devastator" => "systems/pf1/icons/spells/fireball-red-3.jpg",
  "Elementalist" => "systems/pf1/icons/races/creature-types/elemental.png",
  "Exalted One" => "systems/pf1/icons/feats/stunning-fist.jpg",
  "Exarch" => "systems/pf1/icons/spells/heal-royal-3.jpg",
  "Exemplar" => "systems/pf1/icons/items/inventory/badge-sword.jpg",
  "Gadgeteer" => "systems/pf1/icons/skills/mech_7.jpg",
  "Genjutsu Master" => "systems/pf1/icons/spells/evil-eye-eerie-3.jpg",
  "Grand Scholar" => "systems/pf1/icons/items/inventory/book-blue.jpg",
  "Interrogator" => "systems/pf1/icons/spells/horror-eerie-3.jpg",
  "Livewire" => "systems/pf1/icons/items/inventory/net.jpg",
  "Living Puppeteer" => "systems/pf1/icons/items/inventory/monster-heart.jpg",
  "Master Artisan" => "systems/pf1/icons/feats/master-craftsman.jpg",
  "Master Infiltrator" => "systems/pf1/icons/items/inventory/lockpick.jpg",
  "Master Strategist" => "systems/pf1/icons/misc/brain.png",
  "Medical Specialist" => "systems/pf1/icons/actions/heart-plus.svg",
  "Ninja Hunter" => "systems/pf1/icons/items/inventory/monster-eye.jpg",
  "Ninja Police" => "systems/pf1/icons/items/inventory/badge-sword.jpg",
  "Ninja Scout" => "systems/pf1/icons/skills/shadow_08.jpg",
  "Outlaw" => "systems/pf1/icons/items/inventory/badge-skull.jpg",
  "Pain Engine" => "systems/pf1/icons/skills/blood_12.jpg",
  "Poisoner" => "systems/pf1/icons/items/inventory/monster-venom.jpg",
  "Puppeteer" => "systems/pf1/icons/items/inventory/monster-brain.jpg",
  "Reaver" => "systems/pf1/icons/feats/two-weapon-rend.jpg",
  "Rising Star" => "systems/pf1/icons/items/inventory/wand-star.jpg",
  "Sacred Fist" => "systems/pf1/icons/feats/gorgons-fist.jpg",
  "Sage" => "systems/pf1/icons/items/inventory/scroll-druid.jpg",
  "Shade" => "systems/pf1/icons/skills/shadow_01.jpg",
  "Shadow Hand" => "systems/pf1/icons/feats/stealthy.jpg",
  "Sharpshooter" => "systems/pf1/icons/feats/deadly-aim.jpg",
  "Shinobi Adept" => "systems/pf1/icons/items/inventory/scroll-magic.jpg",
  "Shinobi Bodyguard" => "systems/pf1/icons/items/inventory/badge-sword.jpg",
  "Shinobi Swordsman" => "systems/pf1/icons/items/weapons/longsword.png",
  "Shuriken Expert" => "systems/pf1/icons/items/weapons/shuriken.png",
  "Skirmisher" => "systems/pf1/icons/feats/spring-attack.jpg",
  "Sohei" => "systems/pf1/icons/feats/weapon-focus.jpg",
  "Soul Edge" => "systems/pf1/icons/items/weapons/sword-bastard.PNG",
  "Specialist" => "systems/pf1/icons/items/inventory/bomb.jpg",
  "Squad Captain" => "systems/pf1/icons/items/inventory/badge-sword.jpg",
  "Summoner" => "systems/pf1/icons/feats/augument-summoning.jpg",
  "Swarmwrecker" => "systems/pf1/icons/feats/whirlwind-attack.jpg",
  "Sword Savant" => "systems/pf1/icons/items/weapons/sword-dueling.png",
  "Taijutsu Master" => "systems/pf1/icons/feats/stunning-fist.jpg",
  "Takedown Specialist" => "systems/pf1/icons/feats/greater-grapple.jpg",
  "Technique Analyst" => "systems/pf1/icons/items/inventory/scroll-secret.jpg",
  "Technowarrior" => "systems/pf1/icons/skills/mech_12.jpg",
  "Wild Technician" => "systems/pf1/icons/items/inventory/essence-void.jpg",
);

my %associations = (
  "Master Artisan" => [
    ["Compendium.naruto-d20.feats.Item.qYWo4SmcmgCSkQ28", 2],
  ],
  "Ninja Scout" => [
    ["Compendium.naruto-d20.feats.Item.AkeCCqycM8ywq8MK", 1],
  ],
  "Sharpshooter" => [
    ["Compendium.naruto-d20.feats.Item.SWcOsmAU86WMikKi", 2],
  ],
  "Shinobi Adept" => [
    ["Compendium.naruto-d20.feats.Item.M6g0s4Cw88AqUEQA", 1],
  ],
  "Shinobi Swordsman" => [
    ["Compendium.naruto-d20.feats.Item.esmuAacI88Ay8G4s", 2],
  ],
  "Shuriken Expert" => [
    ["Compendium.naruto-d20.feats.Item.SWcOsmAU86WMikKi", 2],
    ["Compendium.naruto-d20.feats.Item.esmuAacI88Ay8G4s", 4],
  ],
  "Summoner" => [
    ["Compendium.naruto-d20.feats.Item.8W8G6CAugsMIAsms", 1],
  ],
);

my @skill_keys = qw(
  acr apr art blf clm crf dip dev dis esc fly han hea int kar kdu ken kge khi
  klo kna kno kpl kre lin lor per prf pro rid sen slt spl ste sur swm umd ckc
  fui gnj nin tai
);

my $json = JSON::PP->new->utf8(0)->canonical(1)->pretty(1);
my $template = $json->decode(read_file($template_path));
my @files = sort glob("$source_dir/*.md");
die "No Markdown class files found in $source_dir\n" unless @files;

my $has_differences = 0;
for my $path (@files) {
  my $markdown = read_file($path);
  my ($name) = $markdown =~ /^#\s+(.+?)\s*$/m;
  die "Missing class name in $path\n" unless $name;

  my ($hd) = $markdown =~ /gains\s+1d(\d+)\s+hit points/i;
  die "Missing Hit Die for $name\n" unless $hd;

  my ($printed_skill_points) =
    $markdown =~ /Skill Points at Each Level\*{0,2}:\*{0,2}\s*(\d+)\s*\+\s*Int/i;
  die "Missing skill points for $name\n" unless $printed_skill_points;
  my $skills_per_level = $printed_skill_points - 1;

  my ($skill_text) =
    $markdown =~ /class skills are as follows[.:](.*?)\*{0,2}Skill Points at Each Level/is;
  die "Missing class skill list for $name\n" unless defined $skill_text;

  my ($class_kind) =
    $markdown =~ /pertains to the \Q$name\E\s+(advanced|prestige)\s+class/i;
  die "Missing advanced/prestige classification for $name\n" unless $class_kind;

  my $table = extract_main_table($markdown, $name);
  my $levels = scalar(@{$table->{bab}});
  my $bab = identify_bab($table->{bab}, $name);
  my $saves = {
    fort => identify_save($table->{fort}, "$name Fort"),
    ref => identify_save($table->{ref}, "$name Ref"),
    will => identify_save($table->{will}, "$name Will"),
  };
  my $defense_formula = identify_defense($table->{defense}, $name);
  my $chakra = extract_chakra($markdown, $name);

  my $id = $fixed_ids{$name} // substr(sha256_hex("naruto-d20 class $name"), 0, 16);
  my $slug = $name;
  $slug =~ s/[^A-Za-z0-9]+/_/g;
  $slug =~ s/^_+|_+$//g;
  my $output_path = "$output_dir/${slug}_${id}.json";

  my $item = deep_clone($template);
  $item->{name} = $name;
  $item->{_id} = $id;
  $item->{_key} = "!items!$id";
  $item->{folder} = $folder_id;
  $item->{img} = $icons{$name} // "systems/pf1/icons/items/inventory/book-purple.jpg";
  $item->{sort} = 0;
  $item->{effects} = [];

  my $system = $item->{system};
  $system->{description} = {
    value => markdown_to_html($markdown),
    instructions => "",
  };
  $system->{tags} = [];
  $system->{changes} = build_changes($name, $defense_formula, $chakra);
  $system->{changeFlags} = {
    immuneToMorale => JSON::PP::false,
    loseDexToAC => JSON::PP::false,
    noMediumEncumbrance => JSON::PP::false,
    noHeavyEncumbrance => JSON::PP::false,
    mediumArmorFullSpeed => JSON::PP::false,
    heavyArmorFullSpeed => JSON::PP::false,
    lowLightVision => JSON::PP::false,
    seeInvisibility => JSON::PP::false,
    seeInDarkness => JSON::PP::false,
  };
  $system->{contextNotes} = [];
  $system->{links} = {
    children => [],
    classAssociations => [],
  };
  $system->{tag} = "";
  $system->{armorProf} = [];
  $system->{weaponProf} = [];
  $system->{languages} = [];
  $system->{flags} = {
    boolean => {},
    dictionary => {},
  };
  $system->{scriptCalls} = [];
  $system->{subType} = lc($class_kind) eq "advanced" ? "base" : "prestige";
  $system->{level} = 1;
  $system->{hd} = 0 + $hd;
  $system->{hp} = undef;
  $system->{bab} = $bab;
  delete $system->{babFormula};
  $system->{skillsPerLevel} = $skills_per_level;
  $system->{savingThrows} = $saves;
  $system->{fc} = {
    hp => { value => 0 },
    skill => { value => 0 },
    alt => { value => 0, notes => "" },
  };
  $system->{wealth} = "";
  $system->{alignment} = "";
  $system->{classSkills} = build_class_skills($skill_text);
  $system->{customHD} = "";
  $system->{casting} = { type => "" };
  $system->{sources} = [
    {
      title => "Naruto d20",
      pages => "",
    },
  ];

  for my $association (@{$associations{$name} // []}) {
    my ($uuid, $level) = @$association;
    push @{$system->{links}{classAssociations}}, {
      uuid => $uuid,
      level => $level,
    };
  }
  my $encoded = $json->encode($item);
  if ($check_only) {
    if (!-f $output_path || read_file($output_path) ne $encoded) {
      warn "Generated output differs: $output_path\n";
      $has_differences = 1;
    }
  } else {
    write_file($output_path, $encoded);
  }
  print "$name: $levels levels -> $output_path\n";
}

exit 1 if $check_only && $has_differences;

sub usage {
  my ($exit_code) = @_;
  print <<'USAGE';
Usage: perl tools/generate-prestige-classes.pl [options]

Options:
  --source-dir PATH  Markdown source directory (default: Classes/Prestige)
  --output-dir PATH  Class JSON output directory (default: packs/_source/classes)
  --template PATH    Existing class JSON used as structural template
  --folder-id ID     Destination compendium folder ID
  --check            Compare generated JSON with existing files without writing
  --help             Show this help
USAGE
  exit $exit_code;
}

sub read_file {
  my ($path) = @_;
  open my $fh, "<:encoding(UTF-8)", $path or die "Cannot read $path: $!\n";
  local $/;
  return <$fh>;
}

sub write_file {
  my ($path, $contents) = @_;
  open my $fh, ">:encoding(UTF-8)", $path or die "Cannot write $path: $!\n";
  print {$fh} $contents;
  close $fh or die "Cannot close $path: $!\n";
}

sub deep_clone {
  my ($value) = @_;
  return $json->decode($json->encode($value));
}

sub extract_main_table {
  my ($markdown, $name) = @_;
  my ($block) =
    $markdown =~ /^(\|[^\n]*Base Attack Bonus[^\n]*\n(?:\|[^\n]*\n)+)/mi;
  die "Missing main table for $name\n" unless $block;

  my @lines = split /\n/, $block;
  my @headers = parse_table_cells(shift @lines);
  shift @lines if @lines && $lines[0] =~ /^\|\s*:?-+/;
  my %indexes;
  for my $index (0 .. $#headers) {
    my $header = lc $headers[$index];
    $header =~ s/\s+/ /g;
    $indexes{bab} = $index if $header eq "base attack bonus";
    $indexes{fort} = $index if $header eq "fort save";
    $indexes{ref} = $index if $header eq "ref save";
    $indexes{will} = $index if $header eq "will save";
    $indexes{defense} = $index if $header eq "defense bonus";
  }
  for my $column (qw(bab fort ref will defense)) {
    die "Missing $column column in main table for $name\n"
      unless defined $indexes{$column};
  }

  my %columns = (
    bab => [],
    fort => [],
    ref => [],
    will => [],
    defense => [],
  );
  for my $line (@lines) {
    next unless $line =~ /^\|\s*\d+(?:st|nd|rd|th)\s*\|/i;
    my @cells = parse_table_cells($line);
    die "Malformed main table row for $name: $line\n"
      unless @cells == @headers;
    for my $column (qw(bab fort ref will defense)) {
      push @{$columns{$column}}, numeric_cell($cells[$indexes{$column}]);
    }
  }
  die "No main table levels for $name\n" unless @{$columns{bab}};
  return \%columns;
}

sub parse_table_cells {
  my ($line) = @_;
  my @cells = map {
    my $cell = $_;
    $cell =~ s/^\s+|\s+$//g;
    $cell;
  } split /\|/, $line;
  shift @cells;
  pop @cells if @cells && $cells[-1] eq "";
  return @cells;
}

sub numeric_cell {
  my ($cell) = @_;
  $cell =~ /([+-]?\d+)/ or die "Expected numeric table cell, got '$cell'\n";
  return 0 + $1;
}

sub identify_bab {
  my ($values, $name) = @_;
  my @patterns = (
    ["high", sub { $_[0] }],
    ["med", sub { int($_[0] * 3 / 4) }],
    ["low", sub { int($_[0] / 2) }],
  );
  for my $pattern (@patterns) {
    my ($key, $fn) = @$pattern;
    return $key if sequence_matches($values, $fn);
  }
  die "Unsupported BAB progression for $name: " . join(",", @$values) . "\n";
}

sub identify_save {
  my ($values, $label) = @_;
  my @patterns = (
    ['2 + floor(@level / 2)', sub { 2 + int($_[0] / 2) }],
    ['floor((2 * @level + 6) / 5)', sub { int((2 * $_[0] + 6) / 5) }],
    ['floor(@level / 3)', sub { int($_[0] / 3) }],
    ['floor((@level - 1) / 3)', sub { int(($_[0] - 1) / 3) }],
  );
  for my $pattern (@patterns) {
    my ($formula, $fn) = @$pattern;
    return {
      value => "custom",
      custom => $formula,
    } if sequence_matches($values, $fn);
  }
  die "Unsupported save progression for $label: " . join(",", @$values) . "\n";
}

sub identify_defense {
  my ($values, $name) = @_;
  my @patterns = (
    ['floor((@item.level + 1) / 2)', sub { int(($_[0] + 1) / 2) }],
    ['floor((2 * @item.level + 2) / 3)', sub { int((2 * $_[0] + 2) / 3) }],
    ['floor((@item.level + 2) / 2)', sub { int(($_[0] + 2) / 2) }],
    ['floor((@item.level + 1) / 3)', sub { int(($_[0] + 1) / 3) }],
    ['floor((@item.level + 3) / 3)', sub { int(($_[0] + 3) / 3) }],
  );
  for my $pattern (@patterns) {
    my ($formula, $fn) = @$pattern;
    return $formula if sequence_matches($values, $fn);
  }
  die "Unsupported Defense progression for $name: " . join(",", @$values) . "\n";
}

sub sequence_matches {
  my ($values, $fn) = @_;
  for my $index (0 .. $#$values) {
    return 0 if $values->[$index] != $fn->($index + 1);
  }
  return 1;
}

sub extract_chakra {
  my ($markdown, $name) = @_;
  return undef unless $markdown =~ /^###\s+Bonus Chakra\s*$/mi;
  my ($block) =
    $markdown =~ /^###\s+Bonus Chakra\s*\n.*?(\|[^\n]*Bonus Chakra[^\n]*(?:Bonus )?Reserve[^\n]*\n(?:\|[^\n]*\n)+)/msi;
  die "Missing Bonus Chakra table for $name\n" unless $block;

  my (@pool, @reserve);
  for my $line (split /\n/, $block) {
    next unless $line =~ /^\|\s*\d+(?:st|nd|rd|th)\s*\|/i;
    my @cells = map {
      my $cell = $_;
      $cell =~ s/^\s+|\s+$//g;
      $cell;
    } split /\|/, $line;
    shift @cells;
    pop @cells if @cells && $cells[-1] eq "";
    push @pool, numeric_cell($cells[1]);
    push @reserve, numeric_cell($cells[2]);
  }

  my @patterns = (
    [
      '@item.level',
      '2 * @item.level',
      sub { $_[0] },
      sub { 2 * $_[0] },
    ],
    [
      '2 * @item.level - 1',
      '4 * @item.level',
      sub { 2 * $_[0] - 1 },
      sub { 4 * $_[0] },
    ],
    [
      'max(1, floor(@item.level / 2))',
      'max(2, @item.level)',
      sub { my $v = int($_[0] / 2); $v > 1 ? $v : 1 },
      sub { $_[0] > 2 ? $_[0] : 2 },
    ],
  );
  for my $pattern (@patterns) {
    my ($pool_formula, $reserve_formula, $pool_fn, $reserve_fn) = @$pattern;
    if (sequence_matches(\@pool, $pool_fn) && sequence_matches(\@reserve, $reserve_fn)) {
      return {
        pool => $pool_formula,
        reserve => $reserve_formula,
      };
    }
  }
  die "Unsupported Chakra progression for $name: pool="
    . join(",", @pool)
    . " reserve="
    . join(",", @reserve)
    . "\n";
}

sub build_changes {
  my ($name, $defense_formula, $chakra) = @_;
  my @changes = ({
    type => "untyped",
    _id => substr(sha256_hex("$name ac"), 0, 16),
    operator => "add",
    priority => 0,
    target => "ac",
    formula => $defense_formula,
  });
  if ($chakra) {
    push @changes, {
      type => "untyped",
      _id => substr(sha256_hex("$name chakraPool"), 0, 16),
      operator => "add",
      priority => 0,
      target => "chakraPool",
      formula => $chakra->{pool},
    };
    push @changes, {
      type => "untyped",
      _id => substr(sha256_hex("$name chakraReserve"), 0, 16),
      operator => "add",
      priority => 0,
      target => "chakraReserve",
      formula => $chakra->{reserve},
    };
  }
  return \@changes;
}

sub build_class_skills {
  my ($text) = @_;
  my %skills = map { $_ => JSON::PP::false } @skill_keys;
  my $normalized = lc $text;
  $normalized =~ s/\s+/ /g;

  my %simple = (
    acr => qr/\b(?:acrobatics|balance|jump|tumble)\b/,
    blf => qr/\bbluff\b/,
    clm => qr/\bclimb\b/,
    crf => qr/\b(?:computer use|craft|repair)\b/,
    dip => qr/\b(?:diplomacy|gather information)\b/,
    dev => qr/\b(?:disable device|demolitions)\b/,
    dis => qr/\bdisguise\b/,
    esc => qr/\bescape artist\b/,
    han => qr/\bhandle animal\b/,
    hea => qr/\btreat injury\b/,
    int => qr/\bintimidate\b/,
    lin => qr/\b(?:decipher script|forgery|linguistics?|read(?:\/write)? language|research|speak language)\b/,
    per => qr/\b(?:investigate|listen|perception|search|spot)\b/,
    prf => qr/\b(?:gamble|perform)\b/,
    pro => qr/\b(?:gamble|profession)\b/,
    rid => qr/\b(?:drive|pilot|ride)\b/,
    sen => qr/\bsense motive\b/,
    slt => qr/\bsleight of hands?\b/,
    ste => qr/\b(?:hide|move silently|stealth)\b/,
    sur => qr/\b(?:navigate|survival)\b/,
    swm => qr/\bswim\b/,
    ckc => qr/\b(?:chakra control|concentration)\b/,
    fui => qr/\bfuinjutsu\b/,
    gnj => qr/\bgenjutsu\b/,
    nin => qr/\bninjutsu\b/,
    tai => qr/\btaijutsu\b/,
  );
  for my $key (keys %simple) {
    $skills{$key} = JSON::PP::true if $normalized =~ $simple{$key};
  }

  $skills{dip} = JSON::PP::true, $skills{klo} = JSON::PP::true
    if $normalized =~ /\bgather information\b/;
  $skills{rid} = JSON::PP::true, $skills{pro} = JSON::PP::true
    if $normalized =~ /\bpilot\b/;
  $skills{dev} = JSON::PP::true, $skills{crf} = JSON::PP::true
    if $normalized =~ /\bdemolitions\b/;

  $skills{ken} = JSON::PP::true
    if $normalized =~ /\bcomputer use\b/;

  if ($normalized =~ /knowledge\s*\(\s*(?:all skills|any)\b/) {
    $skills{$_} = JSON::PP::true for qw(kar kdu ken khi klo kna kno sen pro);
  } else {
    $skills{kar} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*(?:\barcana?\b|\barcane\b|\bninja lore\b|\btactics\b)/;
    $skills{kdu} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*\bshadowlands\b/;
    $skills{ken} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*(?:\bengineering\b|\bphysical sciences?\b)/;
    $skills{khi} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*(?:\bart\b|\bhistory\b)/;
    $skills{klo} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*(?:\bcurrent events\b|\blocal\b|\bpopular culture\b|\bstreetwise\b)/;
    $skills{kna} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*(?:\bearth and life sciences?\b|\bnature\b)/;
    $skills{kno} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*\bcivics\b/;
    $skills{sen} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*\bbehavioral sciences?\b/;
    $skills{pro} = JSON::PP::true
      if $normalized =~ /knowledge\s*\([^)]*\bbusiness\b/;
  }

  return \%skills;
}

sub markdown_to_html {
  my ($markdown) = @_;
  my @lines = split /\n/, $markdown;
  my @html = ('<article class="naruto-d20-class">');
  my @paragraph;
  my $in_list = 0;

  my $flush_paragraph = sub {
    return unless @paragraph;
    my $text = join " ", @paragraph;
    $text =~ s/\s+/ /g;
    push @html, "<p>" . inline_markup($text) . "</p>";
    @paragraph = ();
  };
  my $close_list = sub {
    if ($in_list) {
      push @html, "</ul>";
      $in_list = 0;
    }
  };

  for (my $index = 0; $index <= $#lines; $index++) {
    my $line = $lines[$index];
    if ($line =~ /^\|/ && $index + 1 <= $#lines && $lines[$index + 1] =~ /^\|\s*:?-+/) {
      $flush_paragraph->();
      $close_list->();
      my @table_lines = ($line, $lines[++$index]);
      while ($index + 1 <= $#lines && $lines[$index + 1] =~ /^\|/) {
        push @table_lines, $lines[++$index];
      }
      push @html, markdown_table_to_html(\@table_lines);
      next;
    }
    if ($line =~ /^(#{1,4})\s+(.+?)\s*$/) {
      $flush_paragraph->();
      $close_list->();
      my $level = length($1);
      push @html, "<h$level>" . inline_markup($2) . "</h$level>";
      next;
    }
    if ($line =~ /^\s*[*-]\s+(.+?)\s*$/) {
      $flush_paragraph->();
      if (!$in_list) {
        push @html, "<ul>";
        $in_list = 1;
      }
      push @html, "<li>" . inline_markup($1) . "</li>";
      next;
    }
    if ($line =~ /^\s*$/) {
      $flush_paragraph->();
      $close_list->();
      next;
    }
    push @paragraph, $line;
  }
  $flush_paragraph->();
  $close_list->();
  push @html, "</article>";
  return join "\n", @html;
}

sub markdown_table_to_html {
  my ($lines) = @_;
  my @rows;
  for my $line (@$lines) {
    my @cells = split /\|/, $line;
    shift @cells;
    pop @cells if @cells && $cells[-1] =~ /^\s*$/;
    @cells = map {
      my $cell = $_;
      $cell =~ s/^\s+|\s+$//g;
      $cell;
    } @cells;
    push @rows, \@cells;
  }
  my $header = shift @rows;
  shift @rows;
  my @html = ("<table>", "<thead>", "<tr>");
  push @html, map { "<th>" . inline_markup($_) . "</th>" } @$header;
  push @html, "</tr>", "</thead>", "<tbody>";
  for my $row (@rows) {
    push @html, "<tr>";
    push @html, map { "<td>" . inline_markup($_) . "</td>" } @$row;
    push @html, "</tr>";
  }
  push @html, "</tbody>", "</table>";
  return join "\n", @html;
}

sub inline_markup {
  my ($text) = @_;
  $text =~ s/&/&amp;/g;
  $text =~ s/</&lt;/g;
  $text =~ s/>/&gt;/g;
  $text =~ s/\*\*(.+?)\*\*/<strong>$1<\/strong>/g;
  $text =~ s/\*(.+?)\*/<em>$1<\/em>/g;
  $text =~ s/`(.+?)`/<code>$1<\/code>/g;
  return $text;
}
